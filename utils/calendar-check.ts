import * as Calendar from 'expo-calendar';
import { calendarCheckEvents } from './calendar-check-events';
import { getUpcomingCalendarNotifications, isCalendarEventIgnored } from './database';
import { logger, makeLogHeader } from './logger';

const LOG_FILE = 'utils/calendar-check.ts';

export type ChangedCalendarEvent = {
  calendarId: string;
  originalEventId: string;
  calendarName: string;
  title: string;
  startDate: Date;
  isDeleted: boolean;
  changedFields: string[] | null;
};

// Map recurrence frequency to repeat option (same logic as calendar.tsx)
const mapRecurrenceToRepeatOption = (recurrenceRule: Calendar.RecurrenceRule | null | undefined): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' => {
  if (!recurrenceRule) {
    return 'none';
  }

  // Handle string format (iCal format like "FREQ=DAILY")
  if (typeof recurrenceRule === 'string') {
    const ruleStr = (recurrenceRule as string).toUpperCase();
    if (ruleStr.includes('FREQ=DAILY') || ruleStr.includes('FREQ=DAY')) return 'daily';
    if (ruleStr.includes('FREQ=WEEKLY') || ruleStr.includes('FREQ=WEEK')) return 'weekly';
    if (ruleStr.includes('FREQ=MONTHLY') || ruleStr.includes('FREQ=MONTH')) return 'monthly';
    if (ruleStr.includes('FREQ=YEARLY') || ruleStr.includes('FREQ=YEAR')) return 'yearly';
  }

  // Handle object format
  if (typeof recurrenceRule === 'object' && recurrenceRule !== null && 'frequency' in recurrenceRule) {
    const frequency = (recurrenceRule as any).frequency?.toLowerCase();
    if (frequency === 'daily') return 'daily';
    if (frequency === 'weekly') return 'weekly';
    if (frequency === 'monthly') return 'monthly';
    if (frequency === 'yearly' || frequency === 'year') return 'yearly';
  }

  return 'none';
};

// Normalize location for comparison (treat null/undefined/empty as equivalent)
const normalizeLocation = (location: string | null | undefined): string | null => {
  if (!location || location.trim() === '') {
    return null;
  }
  return location.trim();
};

// Compare two dates accounting for timezone (within 1 minute tolerance)
const datesEqual = (date1: Date, date2: Date): boolean => {
  const diff = Math.abs(date1.getTime() - date2.getTime());
  return diff < 60000; // 1 minute tolerance
};

// Format changed fields into readable sentence
export const formatChangedFields = (changedFields: string[]): string => {
  if (changedFields.length === 0) {
    return '';
  }

  // Map field names to user-friendly names
  const fieldMap: Record<string, string> = {
    'title': 'title',
    'startDate': 'date',
    'location': 'location',
    'recurring': 'recurring pattern',
  };

  const friendlyNames = changedFields.map(field => fieldMap[field] || field);

  if (friendlyNames.length === 1) {
    return `The ${friendlyNames[0]} has changed`;
  } else if (friendlyNames.length === 2) {
    return `The ${friendlyNames[0]} and ${friendlyNames[1]} have changed`;
  } else {
    const lastField = friendlyNames.pop();
    return `The ${friendlyNames.join(', ')} and ${lastField} have changed`;
  }
};

// Check for calendar event changes
export const checkCalendarEventChanges = async (): Promise<ChangedCalendarEvent[]> => {
  // Add a timeout to prevent hanging (5 seconds max)
  const timeoutPromise = new Promise<ChangedCalendarEvent[]>((resolve) => {
    setTimeout(() => {
      logger.info(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), 'Calendar check timed out after 5 seconds');
      resolve([]);
    }, 5000);
  });

  const checkPromise = (async () => {
    try {
      // Check calendar permission first
      const { status } = await Calendar.getCalendarPermissionsAsync();
      if (status !== 'granted') {
        logger.info(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), 'Calendar permission not granted, skipping calendar check');
        return [];
      }

      // Get all upcoming calendar notifications
      const notifications = await getUpcomingCalendarNotifications();
      logger.info(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), `[Calendar Check] Found ${notifications.length} upcoming calendar notifications to check`);
      if (notifications.length === 0) {
        return [];
      }

      const changedEvents: ChangedCalendarEvent[] = [];
      const processedEvents = new Map<string, boolean>(); // Track events to avoid duplicates

      // Limit the number of notifications to check to prevent hanging
      // Check only the first 10 notifications to avoid blocking the UI
      const maxNotificationsToCheck = 10;
      const notificationsToCheck = notifications.slice(0, maxNotificationsToCheck);

      // Fetch all calendars once at the start to avoid repeated API calls
      let calendarsCache: Calendar.Calendar[] = [];
      try {
        calendarsCache = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      } catch (calError) {
        logger.error(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), 'Failed to get calendars:', calError);
        // Continue with empty cache, will use 'Unknown' for calendar names
      }

      for (const notification of notificationsToCheck) {
        if (!notification.calendarId || !notification.originalEventId) {
          continue;
        }

        // Create a unique key for this calendar event
        const eventKey = `${notification.calendarId}-${notification.originalEventId}`;

        // Skip if we've already processed this event
        if (processedEvents.has(eventKey)) {
          continue;
        }

        // Skip if this event is ignored
        const isIgnored = await isCalendarEventIgnored(notification.calendarId, notification.originalEventId);
        if (isIgnored) {
          logger.info(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), `[Calendar Check] Skipping ignored event ${notification.originalEventId}`);
          continue;
        }

        try {
          // Get calendar name from cache
          const calendar = calendarsCache.find(cal => cal.id === notification.calendarId);
          const calendarName = calendar?.title || 'Unknown';

          // Fetch the current event from calendar
          // Use original event start date if available, otherwise fall back to scheduleDateTime
          // Note: scheduleDateTime is when the notification fires, which may differ from event start time
          let originalStartDate: Date;
          if (notification.originalEventStartDate) {
            originalStartDate = new Date(notification.originalEventStartDate);
          } else {
            // Fallback: use scheduleDateTime as approximation (notification was scheduled before originalEventStartDate was added)
            // This is not ideal but allows us to check for changes on older notifications
            logger.info(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), `[Calendar Check] Notification ${notification.notificationId} missing originalEventStartDate, using scheduleDateTime as fallback`);
            originalStartDate = new Date(notification.scheduleDateTime);
          }

          // Use a date range matching the app's event fetching window (30 days)
          // We need to find the event by its ID, so use a reasonable range around the original date
          const startDate = new Date(originalStartDate);
          startDate.setDate(startDate.getDate() - 30); // 30 days before
          const endDate = new Date(originalStartDate);
          endDate.setDate(endDate.getDate() + 30); // 30 days after

          let currentEvent;
          try {
            const events = await Calendar.getEventsAsync(
              [notification.calendarId],
              startDate,
              endDate
            );
            // Find all occurrences of this event (for recurring events, there will be multiple)
            const eventsWithSameId = events.filter(e => e.id === notification.originalEventId);

            if (eventsWithSameId.length === 0) {
              // Event was deleted - use stored original event data for display
              changedEvents.push({
                calendarId: notification.calendarId,
                originalEventId: notification.originalEventId,
                calendarName,
                title: notification.originalEventTitle || notification.message, // Use original event title if available
                startDate: originalStartDate,
                isDeleted: true,
                changedFields: null,
              });
              processedEvents.set(eventKey, true);
              continue;
            }

            // For recurring events, find the occurrence closest to the original start date
            // For non-recurring events, there should be only one occurrence
            const isRecurring = notification.originalEventRecurring && notification.originalEventRecurring !== 'none';

            if (isRecurring && eventsWithSameId.length > 1) {
              // Find the occurrence that matches the original date (within 1 day tolerance)
              // This handles cases where the event was moved slightly
              currentEvent = eventsWithSameId.find(e => {
                const eventStart = new Date(e.startDate);
                const dateDiff = Math.abs(eventStart.getTime() - originalStartDate.getTime());
                return dateDiff < 24 * 60 * 60 * 1000; // Within 1 day
              }) || eventsWithSameId[0]; // Fallback to first occurrence if no match
            } else {
              // Non-recurring or single occurrence - use the first/only one
              currentEvent = eventsWithSameId[0];
            }

          } catch (eventsError) {
            logger.error(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), `Failed to fetch events for calendar ${notification.calendarId}:`, eventsError);
            // Skip this notification if we can't fetch events
            continue;
          }

          if (!currentEvent) {
            // Event was deleted - use stored original event data for display
            changedEvents.push({
              calendarId: notification.calendarId,
              originalEventId: notification.originalEventId,
              calendarName,
              title: notification.originalEventTitle || notification.message, // Use original event title if available
              startDate: originalStartDate,
              isDeleted: true,
              changedFields: null,
            });
            processedEvents.set(eventKey, true);
            continue;
          }

          // Compare fields using stored original event data
          const changedFields: string[] = [];

          // Compare title (original event title vs current event title)
          const originalTitle = notification.originalEventTitle || notification.message;
          if (originalTitle !== currentEvent.title) {
            changedFields.push('title');
          }

          // Compare startDate (original event startDate vs current event startDate)
          // Only compare if we have the original event start date (not using fallback)
          if (notification.originalEventStartDate) {
            const originalStartDateForCompare = new Date(notification.originalEventStartDate);
            const currentStartDate = new Date(currentEvent.startDate);

            // For recurring events, we compare the specific occurrence's date/time
            // If the user changed the event's time pattern, this occurrence will have a different time
            // If they moved this specific occurrence, it will have a different date
            // We use a tolerance of 1 minute for time comparisons
            if (!datesEqual(originalStartDateForCompare, currentStartDate)) {
              logger.info(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), `[Calendar Check] Date changed for event ${notification.originalEventId}:`, {
                original: originalStartDateForCompare.toISOString(),
                current: currentStartDate.toISOString(),
                diffMinutes: Math.abs(originalStartDateForCompare.getTime() - currentStartDate.getTime()) / 60000
              });
              changedFields.push('startDate');
            }
          } else {
            // If we don't have originalEventStartDate, we can't reliably compare dates
            // Skip date comparison but still check other fields (title, location, recurring)
            logger.info(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), `[Calendar Check] Skipping date comparison for ${notification.notificationId} - missing originalEventStartDate`);
          }

          // Compare location (original event location vs current event location)
          const originalLocation = normalizeLocation(notification.originalEventLocation || null);
          const currentLocation = normalizeLocation((currentEvent as any).location || null);
          if (originalLocation !== currentLocation) {
            changedFields.push('location');
          }

          // Compare recurring frequency - just compare the frequency value directly
          const originalRecurring = notification.originalEventRecurring || 'none';

          // Extract frequency from current event's recurrenceRule
          let currentFrequency: string | null = null;
          if (currentEvent.recurrenceRule) {
            if (typeof currentEvent.recurrenceRule === 'string') {
              // iCal format string - extract frequency
              const ruleStr = (currentEvent.recurrenceRule as string).toUpperCase();
              if (ruleStr.includes('FREQ=DAILY')) currentFrequency = 'daily';
              else if (ruleStr.includes('FREQ=WEEKLY')) currentFrequency = 'weekly';
              else if (ruleStr.includes('FREQ=MONTHLY')) currentFrequency = 'monthly';
              else if (ruleStr.includes('FREQ=YEARLY')) currentFrequency = 'yearly';
            } else if (typeof currentEvent.recurrenceRule === 'object' && currentEvent.recurrenceRule !== null && 'frequency' in currentEvent.recurrenceRule) {
              currentFrequency = (currentEvent.recurrenceRule as any).frequency?.toLowerCase() || null;
            }
          }

          // Compare frequencies directly
          const currentRecurring = currentFrequency || 'none';
          if (originalRecurring !== currentRecurring) {
            changedFields.push('recurring');
          }

          // If any fields changed, add to results
          if (changedFields.length > 0) {
            // Use original event start date for display, fallback to current if not available
            const displayStartDate = notification.originalEventStartDate
              ? new Date(notification.originalEventStartDate)
              : new Date(currentEvent.startDate);

            changedEvents.push({
              calendarId: notification.calendarId,
              originalEventId: notification.originalEventId,
              calendarName,
              title: currentEvent.title, // Use current event title for display
              startDate: displayStartDate, // Use original event start date for display
              isDeleted: false,
              changedFields,
            });
            processedEvents.set(eventKey, true);
          }
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), `Failed to check event ${notification.originalEventId}:`, error);
          // Continue with next event
          continue;
        }
      }

      // Emit event for any listeners (e.g., modal in _layout.tsx)
      if (changedEvents.length > 0) {
        calendarCheckEvents.emit(changedEvents);
      }

      return changedEvents;
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), 'Failed to check calendar event changes:', error);
      return [];
    }
  })();

  // Race between the check and timeout
  const result = await Promise.race([checkPromise, timeoutPromise]);
  logger.info(makeLogHeader(LOG_FILE, 'checkCalendarEventChanges'), `[Calendar Check] Final result: ${result.length} changed events`);
  return result;
};

