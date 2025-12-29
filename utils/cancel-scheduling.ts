import * as Notifications from 'expo-notifications';
import { NativeAlarmManager } from 'rn-native-alarmkit';
import { getAllDailyAlarmInstances, markDailyAlarmInstanceCancelled } from './database';
import { logger, makeLogHeader } from './logger';

const LOG_FILE = 'utils/cancel-scheduling.ts';

/**
 * Cancel all Expo scheduled notifications for a parent notification ID
 * This includes:
 * - The main notification (if scheduled with identifier = notificationId)
 * - All rolling-window instance notifications (via data.notificationId matching)
 * 
 * Idempotent: ignores "not found" errors
 */
export async function cancelExpoForParent(notificationId: string): Promise<void> {
  try {
    // First, try to cancel the main notification by identifier
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      logger.info(makeLogHeader(LOG_FILE, 'cancelExpoForParent'), `Cancelled main Expo notification: ${notificationId}`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Ignore "not found" errors - notification may have already been cancelled
      if (!errorMessage.includes('not found') && !errorMessage.includes('NOT_FOUND')) {
        logger.info(makeLogHeader(LOG_FILE, 'cancelExpoForParent'), `Failed to cancel main notification ${notificationId}:`, error);
      }
    }

    // Also sweep all scheduled notifications to catch rolling-window instance orphans
    // These instances have identifier != notificationId but data.notificationId === notificationId
    try {
      const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
      const instancesToCancel = allScheduled.filter(
        (notif) => notif.content.data?.notificationId === notificationId
      );

      for (const instance of instancesToCancel) {
        try {
          await Notifications.cancelScheduledNotificationAsync(instance.identifier);
          logger.info(makeLogHeader(LOG_FILE, 'cancelExpoForParent'), `Cancelled rolling-window instance: ${instance.identifier}`);
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (!errorMessage.includes('not found') && !errorMessage.includes('NOT_FOUND')) {
            logger.info(makeLogHeader(LOG_FILE, 'cancelExpoForParent'), `Failed to cancel instance ${instance.identifier}:`, error);
          }
        }
      }

      if (instancesToCancel.length > 0) {
        logger.info(makeLogHeader(LOG_FILE, 'cancelExpoForParent'), `Cancelled ${instancesToCancel.length} rolling-window instance(s) for ${notificationId}`);
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'cancelExpoForParent'), `Failed to sweep scheduled notifications for ${notificationId}:`, error);
      // Don't throw - continue even if sweep fails
    }
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'cancelExpoForParent'), `Failed to cancel Expo notifications for ${notificationId}:`, error);
    // Don't throw - idempotent operation
  }
}

/**
 * Cancel all AlarmKit alarms for a parent notification ID
 * 
 * For daily alarms: fetches ALL dailyAlarmInstance rows (including inactive) and attempts cancellation
 * For non-daily alarms: attempts cancellation via derived alarmId
 * 
 * Idempotent: ignores "not found" errors and marks DB rows as cancelled only when cancellation succeeds
 */
export async function cancelAlarmKitForParent(
  notificationId: string,
  repeatOption: string | null
): Promise<void> {
  try {
    if (repeatOption === 'daily') {
      // For daily alarms, handle both strategies:
      // 1. Daily window: multiple fixed alarms tracked in dailyAlarmInstance table
      // 2. Native recurring daily: single recurring alarm with derived alarm ID

      // Cancel all daily window instances
      const allInstances = await getAllDailyAlarmInstances(notificationId);

      logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Found ${allInstances.length} daily alarm instance(s) for ${notificationId}`);

      for (const instance of allInstances) {
        try {
          await NativeAlarmManager.cancelAlarm(instance.alarmId);
          logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Cancelled daily alarm instance: ${instance.alarmId}`);

          // Mark as cancelled in DB only if cancellation succeeded
          if (instance.isActive === 1) {
            await markDailyAlarmInstanceCancelled(instance.alarmId);
          }
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Ignore "not found" errors - alarm may have already been cancelled
          if (errorMessage.includes('not found') || errorMessage.includes('ALARM_NOT_FOUND')) {
            logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Alarm ${instance.alarmId} not found (already cancelled)`);
            // Still mark as cancelled in DB if it was active
            if (instance.isActive === 1) {
              await markDailyAlarmInstanceCancelled(instance.alarmId);
            }
          } else {
            logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Failed to cancel daily alarm instance ${instance.alarmId}:`, error);
            // Don't mark as cancelled if cancellation failed
          }
        }
      }

      // Also cancel native recurring daily alarm if it exists (derived alarm ID)
      // This covers the case where a daily alarm uses native recurring instead of window strategy
      const derivedAlarmId = notificationId.substring('thenotifier-'.length);
      try {
        await NativeAlarmManager.cancelAlarm(derivedAlarmId);
        logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Cancelled native recurring daily alarm: ${derivedAlarmId}`);
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Ignore "not found" errors - alarm may not exist or already cancelled
        if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
          logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Failed to cancel native recurring daily alarm ${derivedAlarmId}:`, error);
        } else {
          logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Native recurring daily alarm ${derivedAlarmId} not found (may not exist or already cancelled)`);
        }
      }
    } else {
      // For non-daily alarms (one-time, weekly, monthly, yearly), derive alarmId from notificationId
      const alarmId = notificationId.substring('thenotifier-'.length);

      try {
        await NativeAlarmManager.cancelAlarm(alarmId);
        logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Cancelled non-daily alarm: ${alarmId}`);
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Ignore "not found" errors - alarm may have already been cancelled
        if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
          logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Failed to cancel non-daily alarm ${alarmId}:`, error);
        } else {
          logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Alarm ${alarmId} not found (already cancelled)`);
        }
      }
    }
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmKitForParent'), `Failed to cancel AlarmKit alarms for ${notificationId}:`, error);
    // Don't throw - idempotent operation
  }
}

