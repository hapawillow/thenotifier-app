import * as Calendar from 'expo-calendar';
import { Alert, Linking, Platform } from 'react-native';
import { logger, makeLogHeader } from './logger';

const LOG_FILE = 'utils/open-link.ts';

/**
 * Opens a link, handling both regular URLs and thenotifier://calendar-event deep links.
 * For calendar event links, attempts to open the native calendar app with the event.
 * For regular URLs, opens them using the system's default handler.
 */
export async function openNotifierLink(link: string, t?: (key: string) => string): Promise<void> {
  const getText = (key: string) => t ? t(key) : key;
  if (!link) return;

  // Check if this is a calendar event link
  // Note: link may be URL-encoded when passed as a query parameter, so decode it first
  let decodedLink = link;
  
  // Check if link appears to be URL-encoded (contains % encoded characters)
  if (link.includes('%')) {
    try {
      decodedLink = decodeURIComponent(link);
      logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Decoded URL-encoded link: ${link} -> ${decodedLink}`);
    } catch (e) {
      // If decoding fails, use original link (might be partially encoded or malformed)
      logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Link decoding failed, using original:', e);
      decodedLink = link;
    }
  }
  
  if (decodedLink.startsWith('thenotifier://calendar-event')) {
    logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Processing calendar event link (decoded): ${decodedLink}`);
    try {
      // Parse the calendar event parameters
      let url: URL;
      try {
        url = new URL(decodedLink);
      } catch (urlError) {
        // If URL parsing fails, try to fix common issues
        logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Failed to parse URL, attempting to fix: ${decodedLink}`, urlError);
        // Try adding protocol if missing
        if (!decodedLink.includes('://')) {
          decodedLink = decodedLink.replace('thenotifier://calendar-event', 'thenotifier://calendar-event');
        }
        url = new URL(decodedLink);
      }
      
      const eventId = url.searchParams.get('eventId');
      const calendarId = url.searchParams.get('calendarId');
      const startDateStr = url.searchParams.get('startDate');

      logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
        `Parsed calendar event link - eventId: ${eventId || 'MISSING'}, calendarId: ${calendarId || 'MISSING'}, startDate: ${startDateStr || 'MISSING'}, originalLink: ${link}`);

      if (eventId && calendarId) {
        try {
          if (Platform.OS === 'ios') {
            // iOS: Use calshow: scheme with timestamp (seconds since 2001-01-01)
            // Note: iOS doesn't support opening specific events by EventKit ID reliably
            // The best we can do is open the calendar at the event's start date
            // For recurring events, use the next occurrence date (startDate parameter)
            if (startDateStr) {
              try {
                const startDate = new Date(startDateStr);
                
                // Validate the date was parsed correctly
                if (isNaN(startDate.getTime())) {
                  logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Invalid startDate string: ${startDateStr}`);
                  throw new Error(`Invalid startDate: ${startDateStr}`);
                }
                
                // Calculate seconds since January 1, 2001, 00:00:00 GMT (iOS reference date)
                const referenceDate = new Date('2001-01-01T00:00:00Z');
                const timestamp = Math.floor((startDate.getTime() - referenceDate.getTime()) / 1000);
                
                logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                  `iOS calendar: startDate=${startDateStr}, parsed=${startDate.toISOString()}, timestamp=${timestamp}, referenceDate=${referenceDate.toISOString()}`);
                
                // Ensure timestamp is non-negative (events before 2001 would be negative)
                if (timestamp >= 0) {
                  const calendarUrl = `calshow:${timestamp}`;
                  
                  try {
                    const canOpen = await Linking.canOpenURL(calendarUrl);
                    if (canOpen) {
                      await Linking.openURL(calendarUrl);
                      logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                        `Successfully opened iOS calendar at date: ${startDate.toISOString()} (timestamp: ${timestamp}, URL: ${calendarUrl})`);
                      return; // Success, exit early
                    } else {
                      logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                        `Cannot open iOS calendar URL: ${calendarUrl}, trying fallback`);
                    }
                  } catch (error) {
                    logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                      'Failed to open iOS calendar with timestamp, trying fallback:', error);
                  }
                } else {
                  logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                    `Event date ${startDate.toISOString()} is before iOS reference date (2001-01-01), using fallback`);
                }
              } catch (dateError) {
                logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                  `Failed to parse startDate for iOS calendar: ${startDateStr}`, dateError);
              }
            } else {
              logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                'No startDate provided in calendar event link, using fallback');
            }
            
            // Fallback 1: Try using Expo Calendar API to get event details and show them
            // This helps when we can't open the specific event but can at least show details
            try {
              const startDate = startDateStr ? new Date(startDateStr) : new Date();
              const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days after
              const searchStartDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days before

              const events = await Calendar.getEventsAsync(
                [calendarId],
                searchStartDate,
                endDate
              );

              const event = events.find(e => e.id === eventId);
              if (event) {
                // Try to open calendar at the event date first
                try {
                  const eventStartDate = new Date(event.startDate);
                  const referenceDate = new Date('2001-01-01T00:00:00Z');
                  const eventTimestamp = Math.floor((eventStartDate.getTime() - referenceDate.getTime()) / 1000);
                  
                  if (eventTimestamp >= 0) {
                    const eventCalendarUrl = `calshow:${eventTimestamp}`;
                    const canOpenEvent = await Linking.canOpenURL(eventCalendarUrl);
                    if (canOpenEvent) {
                      await Linking.openURL(eventCalendarUrl);
                      logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                        `Opened iOS calendar at event date using Expo Calendar API: ${eventStartDate.toISOString()}`);
                      return;
                    }
                  }
                } catch (eventDateError) {
                  logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to open calendar at event date:', eventDateError);
                }
                
                // If we can't open at the date, at least show event details
                Alert.alert(
                  getText('alertTitles.menu') || 'Calendar Event',
                  `Event: ${event.title || 'Untitled'}\n\nDate: ${new Date(event.startDate).toLocaleString()}\n\nOpening calendar app...`,
                  [
                    {
                      text: getText('buttonText.ok') || 'OK',
                      onPress: async () => {
                        // Try to open calendar app
                        try {
                          await Linking.openURL('calshow://');
                        } catch (e) {
                          logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to open iOS calendar app:', e);
                        }
                      },
                    },
                  ]
                );
                return;
              } else {
                logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
                  `Event not found in Expo Calendar API: eventId=${eventId}, calendarId=${calendarId}`);
              }
            } catch (expoError) {
              logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Expo Calendar API fallback failed:', expoError);
            }
            
            // Fallback 2: Try opening calendar app without specific date
            try {
              await Linking.openURL('calshow://');
              logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Opened iOS calendar app (final fallback - no specific date)');
            } catch (fallbackError) {
              logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to open iOS calendar app:', fallbackError);
              Alert.alert(getText('alertTitles.error'), getText('errorMessages.unableToOpenCalendarEvent'));
            }
          } else {
            // Android: Tiered fallback approach for better device compatibility
            let opened = false;
            
            // Tier 1: Try content URI (standard Android CalendarContract)
            try {
              const contentUri = `content://com.android.calendar/events/${eventId}`;
              const canOpen = await Linking.canOpenURL(contentUri);
              if (canOpen) {
                await Linking.openURL(contentUri);
                logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Successfully opened Android calendar event (Tier 1): ${eventId}`);
                opened = true;
                return; // Success, exit early
              } else {
                logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Tier 1 (content URI) cannot open: ${contentUri}`);
              }
            } catch (e) {
              logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Tier 1 (content URI) failed:', e);
            }
            
            // Tier 2: Try Google Calendar app
            if (!opened) {
              try {
                const googleUri = `com.google.android.calendar://event?eid=${eventId}`;
                const canOpen = await Linking.canOpenURL(googleUri);
                if (canOpen) {
                  await Linking.openURL(googleUri);
                  logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Successfully opened Android calendar event (Tier 2): ${eventId}`);
                  opened = true;
                  return; // Success, exit early
                } else {
                  logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Tier 2 (Google Calendar) cannot open: ${googleUri}`);
                }
              } catch (e) {
                logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Tier 2 (Google Calendar) failed:', e);
              }
            }
            
            // Tier 3: Try generic calendar provider URI
            if (!opened) {
              try {
                const genericUri = `content://calendar/events/${eventId}`;
                const canOpen = await Linking.canOpenURL(genericUri);
                if (canOpen) {
                  await Linking.openURL(genericUri);
                  logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Successfully opened Android calendar event (Tier 3): ${eventId}`);
                  opened = true;
                  return; // Success, exit early
                } else {
                  logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), `Tier 3 (generic calendar) cannot open: ${genericUri}`);
                }
              } catch (e) {
                logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Tier 3 (generic calendar) failed:', e);
              }
            }
            
            // Tier 4: Fallback to opening calendar app at current time
            if (!opened) {
              try {
                await Linking.openURL('content://com.android.calendar/time/');
                logger.info(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Opened Android calendar app at current time (Tier 4 fallback)');
                opened = true;
              } catch (e) {
                logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Tier 4 (calendar app fallback) failed:', e);
              }
            }
            
            // Tier 5: If all else fails, show user-friendly alert
            if (!opened) {
              logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), `All Android calendar opening tiers failed for eventId: ${eventId}`);
              Alert.alert(
                getText('alertTitles.error') || 'Unable to Open Calendar',
                getText('errorMessages.unableToOpenCalendarEvent') || 'No calendar app found. Please install a calendar app.',
                [
                  {
                    text: 'Install Google Calendar',
                    onPress: () => {
                      Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.calendar').catch((err) => {
                        logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to open Play Store:', err);
                      });
                    },
                  },
                  { text: getText('buttonText.ok') || 'OK', style: 'cancel' },
                ]
              );
            }
          }
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to open calendar event:', error);
          Alert.alert(getText('alertTitles.error'), getText('errorMessages.unableToOpenCalendarEvent'));
        }
      } else {
        logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), 
          `Invalid calendar event link - eventId: ${eventId || 'MISSING'}, calendarId: ${calendarId || 'MISSING'}, link: ${link}`);
        Alert.alert(
          getText('alertTitles.error'), 
          getText('errorMessages.invalidCalendarEventLink') || 'Invalid calendar event link. Missing eventId or calendarId.'
        );
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to parse calendar link:', error);
      Alert.alert(getText('alertTitles.error'), getText('errorMessages.invalidLinkFormat'));
    }
  } else {
    // Regular URL - try to open it
    try {
      const canOpen = await Linking.canOpenURL(link);
      if (canOpen) {
        await Linking.openURL(link);
      } else {
        Alert.alert(getText('alertTitles.error'), getText('errorMessages.unableToOpenLink'));
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to open URL:', error);
      Alert.alert(getText('alertTitles.error'), getText('errorMessages.unableToOpenLinkGeneric'));
    }
  }
}

