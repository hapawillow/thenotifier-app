import * as Notifications from 'expo-notifications';
import { NativeAlarmManager } from 'notifier-alarm-manager';
import { Alert, Platform } from 'react-native';
import { cancelAlarmKitForParent, cancelExpoForParent } from './cancel-scheduling';
import {
  ensureDailyAlarmWindowForAllNotifications,
  ensureRollingWindowNotificationInstances,
  getAllScheduledNotificationData,
  getAppPreference,
  setAppPreference
} from './database';
import { logger, makeLogHeader } from './logger';
import { notificationRefreshEvents } from './notification-refresh-events';

const LOG_FILE = 'utils/orphan-reconcile.ts';

// UX toggle: 'silent' (default) or 'alert'
const ORPHAN_RECONCILE_MODE_KEY = 'orphanReconcileMode';
const DEFAULT_RECONCILE_MODE: 'silent' | 'alert' = 'silent';

/**
 * Get the current orphan reconcile mode (silent or alert)
 */
async function getOrphanReconcileMode(): Promise<'silent' | 'alert'> {
  try {
    const mode = await getAppPreference(ORPHAN_RECONCILE_MODE_KEY);
    if (mode === 'silent' || mode === 'alert') {
      return mode;
    }
    return DEFAULT_RECONCILE_MODE;
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'getOrphanReconcileMode'), 'Failed to get orphan reconcile mode:', error);
    return DEFAULT_RECONCILE_MODE;
  }
}

/**
 * Set the orphan reconcile mode
 */
export async function setOrphanReconcileMode(mode: 'silent' | 'alert'): Promise<void> {
  try {
    await setAppPreference(ORPHAN_RECONCILE_MODE_KEY, mode);
    logger.info(makeLogHeader(LOG_FILE, 'setOrphanReconcileMode'), `Orphan reconcile mode set to: ${mode}`);
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'setOrphanReconcileMode'), 'Failed to set orphan reconcile mode:', error);
    throw error;
  }
}

/**
 * Reconcile summary for logging and UX
 */
interface ReconcileSummary {
  cancelledPlatformOrphans: number;
  cancelledAlarmOrphans: number;
  rescheduledItems: number;
  cancelledDbRemovedItems: number;
  failures: number;
}

/**
 * Force cancel orphaned alarms (for debugging - bypasses future-date safeguards)
 * This function cancels ALL orphaned alarms regardless of their fire date
 */
export async function forceCancelAlarmOrphans(): Promise<{ cancelled: number; failures: number }> {
  let cancelled = 0;
  let failures = 0;

  logger.info(
    makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'),
    'Starting force cleanup of orphaned alarms (bypassing safeguards for debugging)'
  );

  try {
    // Get all alarms from OS
    const allAlarms = await NativeAlarmManager.getAllAlarms();
    logger.info(makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'), `Found ${allAlarms.length} alarms in OS`);

    // Get database notifications to determine valid alarms
    const { getAllScheduledNotificationData, getAllDailyAlarmInstances } = await import('./database');
    const dbScheduledParentsArray = await getAllScheduledNotificationData();
    const dbScheduledParents = new Set(dbScheduledParentsArray.map(p => p.notificationId));
    const dbScheduledWithAlarms = new Set(
      dbScheduledParentsArray
        .filter(p => p.hasAlarm)
        .map(p => p.notificationId)
    );

    // Build set of valid alarm IDs from database
    const validAlarmIds = new Set<string>();
    const validAlarmCategories = new Set<string>(); // For Android category matching
    const NOTIFIER_PREFIX = 'thenotifier-';

    for (const notificationId of dbScheduledWithAlarms) {
      if (notificationId.startsWith(NOTIFIER_PREFIX)) {
        const derivedId = notificationId.substring(NOTIFIER_PREFIX.length);
        validAlarmIds.add(derivedId);
      } else {
        validAlarmIds.add(notificationId);
      }
      validAlarmCategories.add(notificationId);
    }

    // Add alarm IDs from dailyAlarmInstance table
    try {
      for (const notificationId of dbScheduledWithAlarms) {
        const instances = await getAllDailyAlarmInstances(notificationId);
        for (const instance of instances) {
          validAlarmIds.add(instance.alarmId);
          if (instance.alarmId.startsWith(NOTIFIER_PREFIX)) {
            validAlarmIds.add(instance.alarmId.substring(NOTIFIER_PREFIX.length));
          }
        }
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'), 'Failed to get daily alarm instances:', error);
    }

    // Check each OS alarm to see if it belongs to a valid parent
    for (const alarm of allAlarms) {
      try {
        let isOrphan = true;
        const alarmId = alarm?.id;

        if (!alarmId) {
          logger.info(makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'), 'Skipping alarm with no ID:', alarm);
          continue;
        }

        // Check if alarm ID matches a valid ID
        if (validAlarmIds.has(alarmId)) {
          isOrphan = false;
        }

        // Check Android category match
        if (Platform.OS === 'android' && alarm.config?.category && validAlarmCategories.has(alarm.config.category)) {
          isOrphan = false;
        }

        // Check config.data.notificationId match
        if (alarm.config?.data?.notificationId) {
          const parentNotificationId = alarm.config.data.notificationId as string;
          if (dbScheduledParents.has(parentNotificationId)) {
            isOrphan = false;
          }
        }

        // If orphaned, force cancel it (bypassing future-date safeguards)
        if (isOrphan) {
          const scheduleType = alarm.schedule?.type || 'unknown';
          const isOneTime = scheduleType === 'fixed';
          const nextFireStr = alarm.nextFireDate 
            ? (alarm.nextFireDate instanceof Date 
                ? alarm.nextFireDate.toISOString() 
                : String(alarm.nextFireDate))
            : 'unknown';

          logger.info(
            makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'),
            `Force cancelling orphaned alarm: ${alarmId} (schedule type: ${scheduleType}, isOneTime: ${isOneTime}, nextFireDate: ${nextFireStr})`
          );

          try {
            await NativeAlarmManager.cancelAlarm(alarmId);
            logger.info(makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'), `Successfully force-cancelled orphaned alarm: ${alarmId}`);
            cancelled++;
          } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
              logger.error(makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'), `Failed to force-cancel orphaned alarm ${alarmId}:`, error);
              failures++;
            } else {
              logger.info(makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'), `Orphaned alarm ${alarmId} already cleaned up (not found)`);
              cancelled++; // Count as success since it's already cleaned up
            }
          }
        }
      } catch (alarmError) {
        logger.error(
          makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'),
          `Error processing alarm ${alarm?.id || 'unknown'}:`,
          alarmError
        );
        failures++;
      }
    }

    logger.info(
      makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'),
      `Force cleanup complete: cancelled ${cancelled}, failures ${failures}`
    );
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'forceCancelAlarmOrphans'), 'Failed to force cancel alarm orphans:', error);
    failures++;
  }

  return { cancelled, failures };
}

/**
 * Cancel orphaned alarms that don't belong to any database notification
 */
async function cancelAlarmOrphans(
  dbScheduledParents: Set<string>,
  dbScheduledWithAlarms: Set<string>
): Promise<{ cancelled: number; failures: number }> {
  let cancelled = 0;
  let failures = 0;

  logger.info(
    makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
    `Starting cancelAlarmOrphans: dbScheduledParents=${dbScheduledParents.size}, dbScheduledWithAlarms=${dbScheduledWithAlarms.size}`
  );

  try {
    // Get all alarms from OS
    logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), 'Calling NativeAlarmManager.getAllAlarms()...');
    let allAlarms;
    try {
      allAlarms = await NativeAlarmManager.getAllAlarms();
      logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), `getAllAlarms returned ${allAlarms.length} alarms`);
    } catch (getAllAlarmsError) {
      logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), 'Failed to get all alarms:', getAllAlarmsError);
      throw getAllAlarmsError; // Re-throw to be caught by outer catch
    }

    // Build set of valid alarm IDs from database
    const validAlarmIds = new Set<string>();
    const validAlarmCategories = new Set<string>(); // For Android category matching

    logger.info(
      makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
      `Found ${allAlarms.length} alarms in OS. ` +
      `Database has ${dbScheduledWithAlarms.size} notifications with alarms.`
    );

    // Add derived alarm IDs from notificationIds (remove "thenotifier-" prefix)
    const NOTIFIER_PREFIX = 'thenotifier-';
    for (const notificationId of dbScheduledWithAlarms) {
      if (notificationId.startsWith(NOTIFIER_PREFIX)) {
        const derivedId = notificationId.substring(NOTIFIER_PREFIX.length);
        validAlarmIds.add(derivedId);
      } else {
        validAlarmIds.add(notificationId);
      }
      // Android: alarms are tagged with category=notificationId
      validAlarmCategories.add(notificationId);
    }

    // Add alarm IDs from dailyAlarmInstance table
    try {
      const { getAllDailyAlarmInstances } = await import('./database');
      for (const notificationId of dbScheduledWithAlarms) {
        const instances = await getAllDailyAlarmInstances(notificationId);
        for (const instance of instances) {
          validAlarmIds.add(instance.alarmId);
          // Also try without prefix if it has one
          if (instance.alarmId.startsWith(NOTIFIER_PREFIX)) {
            validAlarmIds.add(instance.alarmId.substring(NOTIFIER_PREFIX.length));
          }
        }
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), 'Failed to get daily alarm instances:', error);
    }

    // Check each OS alarm to see if it belongs to a valid parent
    logger.info(
      makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
      `Processing ${allAlarms.length} alarms. Valid alarm IDs: ${Array.from(validAlarmIds).join(', ') || '(none)'}`
    );

    for (const alarm of allAlarms) {
      try {
        let isOrphan = true;
        const alarmId = alarm?.id;

        if (!alarmId) {
          logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), 'Skipping alarm with no ID:', alarm);
          continue;
        }

        let matchReason = '';

        logger.info(
          makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
          `Checking alarm ${alarmId}: schedule type=${alarm.schedule?.type || 'unknown'}, category=${alarm.config?.category || 'none'}, nextFireDate=${alarm.nextFireDate || 'none'}`
        );

        // Check if alarm ID matches a valid ID
        if (validAlarmIds.has(alarmId)) {
          isOrphan = false;
          matchReason = 'alarm ID match';
        }

        // Check Android category match
        if (Platform.OS === 'android' && alarm.config?.category && validAlarmCategories.has(alarm.config.category)) {
          isOrphan = false;
          matchReason = 'category match';
        }

        // Check config.data.notificationId match
        if (alarm.config?.data?.notificationId) {
          const parentNotificationId = alarm.config.data.notificationId as string;
          if (dbScheduledParents.has(parentNotificationId)) {
            isOrphan = false;
            matchReason = 'config.data.notificationId match';

            // Only check dailyAlarmInstance tracking for daily repeat alarms
            // One-time alarms are NOT in dailyAlarmInstance - that's expected
            if (Platform.OS === 'android') {
              try {
                // Check if parent notification is a daily repeat
                const { getScheduledNotificationData, isDailyAlarmInstance } = await import('./database');
                const parentNotification = await getScheduledNotificationData(parentNotificationId);

                // Only check tracking for daily repeat alarms
                if (parentNotification?.repeatOption === 'daily') {
                  const isTracked = await isDailyAlarmInstance(alarmId);

                  if (!isTracked) {
                    // Daily repeat alarm not tracked - treat as duplicate/orphan
                    logger.info(
                      makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
                      `Alarm ${alarmId} belongs to daily repeat notification ${parentNotificationId} but is not tracked in dailyAlarmInstance - treating as duplicate/orphan`
                    );
                    isOrphan = true; // Override: treat as orphan even though parent exists
                    matchReason = ''; // Clear match reason
                  }
                }
                // For one-time alarms (repeatOption !== 'daily'), if they match via notificationId, they're valid
                // No need to check dailyAlarmInstance - one-time alarms don't belong there
              } catch (error) {
                logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
                  `Failed to check if alarm ${alarmId} is tracked:`, error);
                // Continue - if check fails, rely on other orphan detection
              }
            }
          }
        }

        // Log the decision for debugging
        if (isOrphan) {
          let shouldCancel = true;
          let isPastDue = false;
          const scheduleType = alarm.schedule?.type;
          const isOneTime = scheduleType === 'fixed';

          logger.info(
            makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
            `Alarm ${alarmId} is orphaned. Schedule type: ${scheduleType || 'unknown'}, isOneTime: ${isOneTime}, schedule object: ${alarm.schedule ? JSON.stringify(alarm.schedule).substring(0, 100) : 'null'}`
          );

          // Check if alarm is scheduled for the future - if so, be more conservative about cancelling
          // On iOS, alarms scheduled for the future might not have metadata yet
          // CRITICAL SAFEGUARD: This prevents premature removal of valid alarms
          if (alarm.nextFireDate) {
            try {
              // Handle both Date objects and string/number timestamps
              let fireDate: Date;
              if (alarm.nextFireDate instanceof Date) {
                fireDate = alarm.nextFireDate;
              } else if (typeof alarm.nextFireDate === 'string') {
                // Try parsing as ISO string first, then as timestamp
                fireDate = new Date(alarm.nextFireDate);
                if (isNaN(fireDate.getTime())) {
                  // Might be a numeric string (timestamp in milliseconds)
                  const timestamp = parseFloat(alarm.nextFireDate);
                  fireDate = isNaN(timestamp) ? new Date() : new Date(timestamp);
                }
              } else if (typeof alarm.nextFireDate === 'number') {
                // Timestamp - if it's a small number (< year 2000 in seconds), assume seconds, otherwise milliseconds
                fireDate = alarm.nextFireDate < 946684800000
                  ? new Date(alarm.nextFireDate * 1000)
                  : new Date(alarm.nextFireDate);
              } else {
                fireDate = new Date();
              }

              const now = new Date();
              const fireTime = fireDate.getTime();
              const nowTime = now.getTime();

              // CRITICAL SAFEGUARD: If alarm is scheduled more than 1 hour in the future, don't cancel it
              // This prevents premature removal of valid alarms that might be missing metadata temporarily
              // Applies to both Android and iOS to prevent regressions
              if (fireTime > nowTime + 3600000) {
                logger.info(
                  makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
                  `Skipping cancellation of future alarm ${alarmId} (fires at ${fireDate.toISOString()}) - may be valid but missing metadata`
                );
                shouldCancel = false;
              } else if (fireTime < nowTime) {
                // CRITICAL SAFEGUARD: Only mark as past-due if fireTime < nowTime (strictly less than, not <=)
                // This ensures we only clean up alarms that have definitely fired
                // Past-due alarm (fired more than 1 second ago to account for timing)
                isPastDue = true;
                logger.info(
                  makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
                  `Detected past-due orphan alarm ${alarmId}: fired at ${fireDate.toISOString()}, now is ${now.toISOString()}, schedule type: ${scheduleType}, platform: ${Platform.OS}`
                );
              }
            } catch (e) {
              logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), `Error parsing nextFireDate for alarm ${alarmId}:`, e);
              // If we can't parse the date, don't risk removing valid alarms - skip cancellation
              // This is a safeguard to prevent premature removal
              shouldCancel = false;
            }
          }

          if (shouldCancel) {
            logger.info(
              makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
              `Alarm ${alarmId} appears to be orphaned (${isPastDue ? 'past-due' : 'future'}, ${isOneTime ? 'one-time' : 'repeat'}). ` +
              `Schedule type: ${scheduleType || 'unknown'}, ` +
              `Valid alarm IDs: ${Array.from(validAlarmIds).slice(0, 5).join(', ')}${validAlarmIds.size > 5 ? '...' : ''}, ` +
              `Category: ${alarm.config?.category || 'none'}, ` +
              `Config notificationId: ${alarm.config?.data?.notificationId || 'none'}`
            );
            try {
              // Use cancelAlarm for all orphan alarms - it handles both AlarmManager cancellation and storage deletion
              // This is simpler and more reliable than trying to use deleteAlarmFromStorage
              logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), `Attempting to cancel orphaned alarm: ${alarmId} (pastDue=${isPastDue}, oneTime=${isOneTime}, platform=${Platform.OS})`);
              await NativeAlarmManager.cancelAlarm(alarmId);
              logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), `Successfully cancelled orphaned alarm: ${alarmId}`);
              cancelled++;
            } catch (error: any) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              // Don't count "not found" errors as failures - alarm may have already been cleaned up
              if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
                logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), `Failed to cancel orphaned alarm ${alarmId}:`, error);
                failures++;
              } else {
                logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'), `Orphaned alarm ${alarmId} already cleaned up (not found)`);
                cancelled++; // Count as success since it's already cleaned up
              }
            }
          }
        } else {
          logger.info(
            makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
            `Alarm ${alarmId} is valid (${matchReason}), keeping it`
          );
        }
      } catch (alarmError) {
        const errorMessage = alarmError instanceof Error ? alarmError.message : String(alarmError);
        const errorStack = alarmError instanceof Error ? alarmError.stack : undefined;
        logger.error(
          makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
          `Error processing alarm ${alarm?.id || 'unknown'}: ${errorMessage}`,
          errorStack ? { stack: errorStack } : alarmError
        );
        failures++;
        // Continue with next alarm
      }
    }
  } catch (error) {
    // Log error details in multiple ways to ensure we capture it
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.name : typeof error;
    const errorString = error instanceof Error ? error.toString() : JSON.stringify(error);

    console.error('[cancelAlarmOrphans] Error caught:', {
      error,
      errorMessage,
      errorStack,
      errorName,
      errorString,
      errorType: typeof error,
      errorConstructor: error?.constructor?.name
    });

    logger.error(
      makeLogHeader(LOG_FILE, 'cancelAlarmOrphans'),
      `Failed to cancel alarm orphans: ${errorMessage || errorString || 'Unknown error'}`,
      {
        errorName,
        errorMessage,
        errorStack,
        errorString,
        errorType: typeof error,
        rawError: error
      }
    );
    failures++;
  }

  return { cancelled, failures };
}

/**
 * Step 1: Cancel platform extras (true orphans)
 * Cancel any scheduled platform notifications/alarms that cannot be attributed to a DB-scheduled parent
 */
async function cancelPlatformOrphans(
  dbScheduledParents: Set<string>
): Promise<{ cancelled: number; alarmCancelled: number; failures: number }> {
  let cancelled = 0;
  let alarmCancelled = 0;
  let failures = 0;

  try {
    // Cancel orphaned Expo notifications
    const allScheduled = await Notifications.getAllScheduledNotificationsAsync();

    for (const notif of allScheduled) {
      const identifier = notif.identifier;
      const maybeParentId = notif.content.data?.notificationId;
      const parentId = typeof maybeParentId === 'string' ? maybeParentId : identifier;

      // Check if this notification belongs to our app
      if (!identifier.startsWith('thenotifier-')) {
        continue;
      }

      // Check if parent exists in DB
      if (!dbScheduledParents.has(parentId)) {
        try {
          await Notifications.cancelScheduledNotificationAsync(identifier);
          logger.info(makeLogHeader(LOG_FILE, 'cancelPlatformOrphans'), `Cancelled orphaned Expo notification: ${identifier} (parent: ${parentId})`);
          cancelled++;
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (!errorMessage.includes('not found') && !errorMessage.includes('NOT_FOUND')) {
            logger.info(makeLogHeader(LOG_FILE, 'cancelPlatformOrphans'), `Failed to cancel orphaned notification ${identifier}:`, error);
            failures++;
          }
        }
      }
    }

    // Cancel orphaned alarms
    // Get notifications that have alarms enabled
    try {
      const dbScheduledParentsArray = await getAllScheduledNotificationData();
      const dbScheduledWithAlarms = new Set(
        dbScheduledParentsArray
          .filter(p => p.hasAlarm)
          .map(p => p.notificationId)
      );

      const alarmOrphanResult = await cancelAlarmOrphans(dbScheduledParents, dbScheduledWithAlarms);
      alarmCancelled = alarmOrphanResult.cancelled;
      failures += alarmOrphanResult.failures;
    } catch (alarmError) {
      logger.error(makeLogHeader(LOG_FILE, 'cancelPlatformOrphans'), 'Failed to cancel alarm orphans:', alarmError);
      failures++;
    }
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'cancelPlatformOrphans'), 'Failed to cancel platform orphans:', error);
    failures++;
  }

  return { cancelled, alarmCancelled, failures };
}

/**
 * Step 2: Ensure platform matches DB (auto-heal)
 * Reschedule missing platform items that DB says should exist
 */
async function ensurePlatformMatchesDB(
  dbScheduledParents: Array<{
    notificationId: string;
    repeatOption: string | null;
    repeatMethod: string | null;
    notificationTrigger: any;
    hasAlarm: boolean;
    scheduleDateTime: string;
  }>,
  notificationPermissionGranted: boolean,
  alarmPermissionAuthorized: boolean
): Promise<{ rescheduled: number; failures: number }> {
  let rescheduled = 0;
  let failures = 0;

  try {
    // Get all currently scheduled Expo notifications to check what exists
    const platformScheduled = await Notifications.getAllScheduledNotificationsAsync();
    const platformNotificationIds = new Set(
      platformScheduled.map(n => {
        // For main notifications, identifier = notificationId
        // For instances, check data.notificationId
        return n.identifier.startsWith('thenotifier-') && !n.identifier.startsWith('thenotifier-instance-')
          ? n.identifier
          : n.content.data?.notificationId;
      }).filter(Boolean) as string[]
    );

    // iOS-only: Track if we need to replenish daily alarm windows (call once per pass, not per parent)
    let iosNeedsDailyAlarmReplenish = false;

    for (const parent of dbScheduledParents) {
      try {
        const existsOnPlatform = platformNotificationIds.has(parent.notificationId);

        // Ensure Expo repeating notification exists (if using expo repeat method)
        if (parent.repeatMethod === 'expo' && !existsOnPlatform && notificationPermissionGranted) {
          // The notification should exist but doesn't - this is handled by replenishers
          // We'll log it but not reschedule here (replenishers handle it)
          logger.info(makeLogHeader(LOG_FILE, 'ensurePlatformMatchesDB'), `Expo repeating notification missing for ${parent.notificationId}, will be handled by replenishers`);
        }

        // Ensure rolling-window instances exist
        if (parent.repeatMethod === 'rollingWindow' && notificationPermissionGranted) {
          try {
            await ensureRollingWindowNotificationInstances();
            rescheduled++;
          } catch (error) {
            logger.error(makeLogHeader(LOG_FILE, 'ensurePlatformMatchesDB'), `Failed to ensure rolling-window instances for ${parent.notificationId}:`, error);
            failures++;
          }
        }

        // iOS-only: Track if we need to replenish daily alarm windows (call once per pass)
        if (
          Platform.OS === 'ios' &&
          parent.repeatOption === 'daily' &&
          parent.hasAlarm &&
          parent.repeatMethod === 'rollingWindow' &&
          alarmPermissionAuthorized &&
          notificationPermissionGranted
        ) {
          iosNeedsDailyAlarmReplenish = true;
        }

        // Android: Continue calling per-parent (existing behavior)
        if (
          Platform.OS === 'android' &&
          parent.repeatOption === 'daily' &&
          parent.hasAlarm &&
          alarmPermissionAuthorized &&
          notificationPermissionGranted
        ) {
          try {
            await ensureDailyAlarmWindowForAllNotifications();
            rescheduled++;
          } catch (error) {
            logger.error(makeLogHeader(LOG_FILE, 'ensurePlatformMatchesDB'), `Failed to ensure daily alarm window for ${parent.notificationId}:`, error);
            failures++;
          }
        }

        // Note: Native recurring daily alarms are handled by checking if the derived alarm ID exists
        // If missing, we'd need to reschedule, but that's complex and should be handled by the scheduling logic
        // For now, we rely on the cancellation logic to remove orphans
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'ensurePlatformMatchesDB'), `Failed to ensure platform matches DB for ${parent.notificationId}:`, error);
        failures++;
      }
    }

    // iOS-only: Call replenisher once per reconcile pass (not per parent)
    if (Platform.OS === 'ios' && iosNeedsDailyAlarmReplenish && alarmPermissionAuthorized && notificationPermissionGranted) {
      try {
        await ensureDailyAlarmWindowForAllNotifications();
        rescheduled++;
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'ensurePlatformMatchesDB'), `Failed to ensure daily alarm window (iOS batch):`, error);
        failures++;
      }
    }
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'ensurePlatformMatchesDB'), 'Failed to ensure platform matches DB:', error);
    failures++;
  }

  return { rescheduled, failures };
}

/**
 * Step 3: Cancel platform items that DB says shouldn't exist
 * For DB parents that are not supposed to be active, cancel all platform children
 */
async function cancelDbRemovedItems(
  dbScheduledParents: Set<string>
): Promise<{ cancelled: number; failures: number }> {
  let cancelled = 0;
  let failures = 0;

  try {
    // Get all scheduled notifications from platform
    const platformScheduled = await Notifications.getAllScheduledNotificationsAsync();

    // Get all DB parents
    const dbParents = dbScheduledParents;

    // Find platform items whose parents are not in DB
    const orphanedParents = new Set<string>();

    for (const notif of platformScheduled) {
      const maybeParentId = notif.content.data?.notificationId;
      const parentId = typeof maybeParentId === 'string' ? maybeParentId : notif.identifier;
      if (parentId.startsWith('thenotifier-') && !dbParents.has(parentId)) {
        orphanedParents.add(parentId);
      }
    }

    // Cancel all platform children for orphaned parents
    for (const parentId of orphanedParents) {
      try {
        // Cancel Expo notifications (includes rolling-window instances)
        await cancelExpoForParent(parentId);
        cancelled++;

        // Cancel alarms (try both daily and non-daily strategies)
        // First try as daily (will cancel window instances if they exist)
        await cancelAlarmKitForParent(parentId, 'daily').catch(() => {
          // Ignore - parent may not have had daily alarms
        });

        // Also try as non-daily (will cancel derived alarm ID for recurring alarms)
        await cancelAlarmKitForParent(parentId, null).catch(() => {
          // Ignore - parent may not have had alarms or may have been daily
        });

        cancelled++;
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'cancelDbRemovedItems'), `Failed to cancel platform items for removed parent ${parentId}:`, error);
        failures++;
      }
    }
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'cancelDbRemovedItems'), 'Failed to cancel DB removed items:', error);
    failures++;
  }

  return { cancelled, failures };
}

/**
 * Main orphan reconciliation function
 * Compares DB scheduled state vs platform scheduled state and reconciles discrepancies
 */
export async function reconcileOrphansOnStartup(t?: (key: string) => string): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    cancelledPlatformOrphans: 0,
    cancelledAlarmOrphans: 0,
    rescheduledItems: 0,
    cancelledDbRemovedItems: 0,
    failures: 0,
  };

  try {
    logger.info(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Starting orphan reconciliation');

    // Wrap each step in try-catch to prevent one failure from crashing the entire process
    // This prevents app restarts caused by unhandled errors

    // Check permissions
    let notificationPermissionGranted = false;
    let alarmPermissionAuthorized = false;

    try {
      const notificationPerms = await Notifications.getPermissionsAsync();
      notificationPermissionGranted = notificationPerms.status === 'granted';
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Failed to check notification permissions:', error);
    }

    try {
      const alarmCapability = await NativeAlarmManager.checkCapability();
      alarmPermissionAuthorized =
        alarmCapability.capability !== 'none' &&
        (!alarmCapability.requiresPermission || alarmCapability.platformDetails?.alarmKitAuthStatus === 'authorized');
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Failed to check alarm capability:', error);
    }

    // Get DB scheduled parents
    const dbScheduledParents = await getAllScheduledNotificationData();
    const dbParentIds = new Set(dbScheduledParents.map(p => p.notificationId));

    // Step 1: Cancel platform extras (true orphans)
    try {
      const step1Result = await cancelPlatformOrphans(dbParentIds);
      summary.cancelledPlatformOrphans = step1Result.cancelled;
      summary.cancelledAlarmOrphans = step1Result.alarmCancelled;
      summary.failures += step1Result.failures;
    } catch (step1Error) {
      logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Step 1 (cancel platform orphans) failed:', step1Error);
      summary.failures++;
      // Continue with other steps even if this one fails
    }

    // Step 2: Ensure platform matches DB (auto-heal)
    if (notificationPermissionGranted || alarmPermissionAuthorized) {
      try {
        const step2Result = await ensurePlatformMatchesDB(
          dbScheduledParents,
          notificationPermissionGranted,
          alarmPermissionAuthorized
        );
        summary.rescheduledItems = step2Result.rescheduled;
        summary.failures += step2Result.failures;
      } catch (step2Error) {
        logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Step 2 (ensure platform matches DB) failed:', step2Error);
        summary.failures++;
        // Continue with other steps even if this one fails
      }
    }

    // Step 3: Cancel platform items that DB says shouldn't exist
    try {
      const step3Result = await cancelDbRemovedItems(dbParentIds);
      summary.cancelledDbRemovedItems = step3Result.cancelled;
      summary.failures += step3Result.failures;
    } catch (step3Error) {
      logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Step 3 (cancel DB removed items) failed:', step3Error);
      summary.failures++;
      // Continue even if this step fails
    }

    // Log summary
    logger.info(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Orphan reconciliation complete:', summary);

    // Show alert if mode is 'alert' and actions were taken
    const mode = await getOrphanReconcileMode();
    const hasActions = summary.cancelledPlatformOrphans > 0 || summary.cancelledAlarmOrphans > 0 || summary.rescheduledItems > 0 || summary.cancelledDbRemovedItems > 0;

    if (mode === 'alert' && hasActions && t) {
      const totalCancelled = summary.cancelledPlatformOrphans + summary.cancelledAlarmOrphans + summary.cancelledDbRemovedItems;
      const message = `Reconciled ${totalCancelled} orphaned items (${summary.cancelledPlatformOrphans} notifications, ${summary.cancelledAlarmOrphans} alarms) and rescheduled ${summary.rescheduledItems} missing items.`;
      Alert.alert('Orphan Reconciliation', message, [{ text: 'OK' }]);
    }

    // Emit refresh event to update UI
    if (hasActions) {
      notificationRefreshEvents.emit();
    }

    return summary;
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Failed to reconcile orphans:', error);
    summary.failures++;
    return summary;
  }
}

/**
 * Lighter reconciliation variant for foreground (only cancel platform extras + ensure DB-scheduled are present)
 */
export async function reconcileOrphansOnForeground(t?: (key: string) => string): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    cancelledPlatformOrphans: 0,
    cancelledAlarmOrphans: 0,
    rescheduledItems: 0,
    cancelledDbRemovedItems: 0,
    failures: 0,
  };

  try {
    logger.info(makeLogHeader(LOG_FILE, 'reconcileOrphansOnForeground'), 'Starting foreground orphan reconciliation');

    // Check permissions
    let notificationPermissionGranted = false;
    let alarmPermissionAuthorized = false;

    try {
      const notificationPerms = await Notifications.getPermissionsAsync();
      notificationPermissionGranted = notificationPerms.status === 'granted';
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnForeground'), 'Failed to check notification permissions:', error);
    }

    try {
      const alarmCapability = await NativeAlarmManager.checkCapability();
      alarmPermissionAuthorized =
        alarmCapability.capability !== 'none' &&
        (!alarmCapability.requiresPermission || alarmCapability.platformDetails?.alarmKitAuthStatus === 'authorized');
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnForeground'), 'Failed to check alarm capability:', error);
    }

    // Get DB scheduled parents
    const dbScheduledParents = await getAllScheduledNotificationData();
    const dbParentIds = new Set(dbScheduledParents.map(p => p.notificationId));

    // Step 1: Cancel platform extras (true orphans)
    const step1Result = await cancelPlatformOrphans(dbParentIds);
    summary.cancelledPlatformOrphans = step1Result.cancelled;
    summary.cancelledAlarmOrphans = step1Result.alarmCancelled;
    summary.failures += step1Result.failures;

    // Step 2: Ensure platform matches DB (auto-heal) - lighter version
    if (notificationPermissionGranted || alarmPermissionAuthorized) {
      const step2Result = await ensurePlatformMatchesDB(
        dbScheduledParents,
        notificationPermissionGranted,
        alarmPermissionAuthorized
      );
      summary.rescheduledItems = step2Result.rescheduled;
      summary.failures += step2Result.failures;
    }

    // Log summary
    logger.info(makeLogHeader(LOG_FILE, 'reconcileOrphansOnForeground'), 'Foreground orphan reconciliation complete:', summary);

    // Emit refresh event if actions were taken
    const hasActions = summary.cancelledPlatformOrphans > 0 || summary.cancelledAlarmOrphans > 0 || summary.rescheduledItems > 0;
    if (hasActions) {
      notificationRefreshEvents.emit();
    }

    return summary;
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'reconcileOrphansOnForeground'), 'Failed to reconcile orphans on foreground:', error);
    summary.failures++;
    return summary;
  }
}

