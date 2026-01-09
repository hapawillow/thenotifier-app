import * as Notifications from 'expo-notifications';
import { Alert } from 'react-native';
import { NativeAlarmManager } from 'notifier-alarm-manager';
import { cancelAlarmKitForParent, cancelExpoForParent } from './cancel-scheduling';
import {
  archiveAllScheduledNotificationsAsCancelled,
  deleteAllScheduledNotifications,
  getAllDailyAlarmInstances,
  getAllScheduledNotificationData,
  getAppPreference,
  markAllDailyAlarmInstancesCancelledForAllNotifications,
  markAllRepeatNotificationInstancesCancelledForAllParents,
  markDailyAlarmInstanceCancelled,
  saveAlarmPermissionDenied,
  setAppPreference,
  updateScheduledNotificationData,
} from './database';
import { logger, makeLogHeader } from './logger';
import { notificationRefreshEvents } from './notification-refresh-events';

const LOG_FILE = 'utils/permission-reconcile.ts';

type NotificationPermissionState = 'granted' | 'denied';
type AlarmPermissionState = 'authorized' | 'denied' | 'notSupported';

/**
 * Get current notification permission state
 */
async function getCurrentNotificationPermission(): Promise<NotificationPermissionState> {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    return permissions.status === 'granted' ? 'granted' : 'denied';
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'getCurrentNotificationPermission'), 'Failed to get notification permissions:', error);
    return 'denied'; // Default to denied on error
  }
}

/**
 * Get current alarm permission state
 */
async function getCurrentAlarmPermission(): Promise<AlarmPermissionState> {
  try {
    const capability = await NativeAlarmManager.checkCapability();

    // If capability is 'none', alarms are not supported
    if (capability.capability === 'none') {
      return 'notSupported';
    }

    // If permission is not required, consider it authorized
    if (!capability.requiresPermission) {
      return 'authorized';
    }

    // Check auth status
    const authStatus = capability.platformDetails?.alarmKitAuthStatus;
    if (authStatus === 'authorized') {
      return 'authorized';
    }

    return 'denied';
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'getCurrentAlarmPermission'), 'Failed to get alarm capability:', error);
    return 'denied'; // Default to denied on error
  }
}


/**
 * Cleanup when notification permission is removed
 */
async function cleanupNotificationPermissionRemoved(t: (key: string) => string): Promise<void> {
  logger.info(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Starting notification permission removal cleanup');

  try {
    // Get all scheduled notifications before cleanup
    const scheduledNotifications = await getAllScheduledNotificationData();

    // Cancel all Expo notifications (comprehensive sweep)
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      logger.info(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Cancelled all scheduled Expo notifications');
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Failed to cancel all Expo notifications:', error);
      // Continue with per-notification cleanup even if bulk cancellation fails
    }

    // Also cancel per-notification to catch any missed by cancelAll (idempotent)
    for (const notification of scheduledNotifications) {
      await cancelExpoForParent(notification.notificationId);
    }

    // Cancel all AlarmKit alarms for scheduled notifications
    // Always attempt cancellation regardless of hasAlarm flag (idempotent)
    for (const notification of scheduledNotifications) {
      await cancelAlarmKitForParent(notification.notificationId, notification.repeatOption);
    }

    // Additional sweep: cancel any daily alarm instances found in DB (even if inactive)
    // This catches cases where DB state doesn't match device state
    for (const notification of scheduledNotifications) {
      if (notification.repeatOption === 'daily') {
        const allDailyInstances = await getAllDailyAlarmInstances(notification.notificationId);
        for (const instance of allDailyInstances) {
          try {
            const { NativeAlarmManager } = await import('notifier-alarm-manager');
            await NativeAlarmManager.cancelAlarm(instance.alarmId);
            logger.info(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), `Cancelled daily alarm instance from DB sweep: ${instance.alarmId}`);
            if (instance.isActive === 1) {
              await markDailyAlarmInstanceCancelled(instance.alarmId);
            }
          } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
              logger.error(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), `Failed to cancel daily alarm instance ${instance.alarmId} from DB sweep:`, error);
            }
          }
        }
      }
    }

    // Archive all scheduled notifications with cancelledAt set
    const cancelledAtIso = new Date().toISOString();
    await archiveAllScheduledNotificationsAsCancelled(cancelledAtIso);
    logger.info(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Archived all scheduled notifications as cancelled');

    // Mark all repeat notification instances as cancelled
    await markAllRepeatNotificationInstancesCancelledForAllParents();
    logger.info(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Marked all repeat notification instances as cancelled');

    // Mark all daily alarm instances as cancelled
    await markAllDailyAlarmInstancesCancelledForAllNotifications();
    logger.info(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Marked all daily alarm instances as cancelled');

    // Delete all scheduled notifications from Upcoming table
    await deleteAllScheduledNotifications();
    logger.info(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Deleted all scheduled notifications from Upcoming table');

    // Emit refresh event to update UI
    notificationRefreshEvents.emit();

    // Show alert
    Alert.alert(
      t('alertTitles.warning'),
      t('alertMessages.notificationPermissionRemovedCleanup'),
      [{ text: t('buttonText.ok') }]
    );
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Failed to cleanup notification permission removal:', error);
    throw error;
  }
}

/**
 * Cleanup when alarm permission is removed (but notifications are still enabled)
 */
async function cleanupAlarmPermissionRemoved(t: (key: string) => string): Promise<void> {
  logger.info(makeLogHeader(LOG_FILE, 'cleanupAlarmPermissionRemoved'), 'Starting alarm permission removal cleanup');

  try {
    // Get all scheduled notifications
    const scheduledNotifications = await getAllScheduledNotificationData();

    // Cancel all AlarmKit alarms for ALL notifications (not just those with hasAlarm=true)
    // This ensures we catch any alarms even if DB state is stale
    for (const notification of scheduledNotifications) {
      // Always attempt cancellation regardless of hasAlarm flag (idempotent)
      await cancelAlarmKitForParent(notification.notificationId, notification.repeatOption);

      // Update hasAlarm to false in database (only if it was true)
      if (notification.hasAlarm) {
        await updateScheduledNotificationData(
          notification.notificationId,
          notification.title,
          notification.message,
          notification.note || '',
          notification.link || '',
          notification.scheduleDateTime,
          notification.scheduleDateTimeLocal,
          notification.repeatOption || undefined,
          notification.notificationTrigger,
          false // hasAlarm = false
        );
        logger.info(makeLogHeader(LOG_FILE, 'cleanupAlarmPermissionRemoved'), `Updated hasAlarm to false for ${notification.notificationId}`);
      }
    }

    // Additional sweep: cancel any daily alarm instances found in DB (even if inactive)
    // This catches cases where DB state doesn't match device state
    for (const notification of scheduledNotifications) {
      if (notification.repeatOption === 'daily') {
        const allDailyInstances = await getAllDailyAlarmInstances(notification.notificationId);
        for (const instance of allDailyInstances) {
          try {
            const { NativeAlarmManager } = await import('notifier-alarm-manager');
            await NativeAlarmManager.cancelAlarm(instance.alarmId);
            logger.info(makeLogHeader(LOG_FILE, 'cleanupAlarmPermissionRemoved'), `Cancelled daily alarm instance from DB sweep: ${instance.alarmId}`);
            if (instance.isActive === 1) {
              await markDailyAlarmInstanceCancelled(instance.alarmId);
            }
          } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
              logger.error(makeLogHeader(LOG_FILE, 'cleanupAlarmPermissionRemoved'), `Failed to cancel daily alarm instance ${instance.alarmId} from DB sweep:`, error);
            }
          }
        }
      }
    }

    // Update alarm permission denied state
    await saveAlarmPermissionDenied(true);

    // Emit refresh event to update UI
    notificationRefreshEvents.emit();

    // Show alert
    Alert.alert(
      t('alertTitles.warning'),
      t('alertMessages.alarmPermissionRemovedCleanup'),
      [{ text: t('buttonText.ok') }]
    );
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'cleanupAlarmPermissionRemoved'), 'Failed to cleanup alarm permission removal:', error);
    throw error;
  }
}

/**
 * Reconcile permissions on foreground - detects permission transitions and performs cleanup
 * @param t Translation function from i18n
 * @returns Object indicating if cleanup was performed
 */
export async function reconcilePermissionsOnForeground(t: (key: string) => string): Promise<{ didCleanup: boolean }> {
  try {
    logger.info(makeLogHeader(LOG_FILE, 'reconcilePermissionsOnForeground'), 'Starting permission reconciliation');

    // Read current permissions
    const currentNotificationPerm = await getCurrentNotificationPermission();
    const currentAlarmPerm = await getCurrentAlarmPermission();

    logger.info(makeLogHeader(LOG_FILE, 'reconcilePermissionsOnForeground'), `Current permissions - Notification: ${currentNotificationPerm}, Alarm: ${currentAlarmPerm}`);

    // Load last-known states
    const lastKnownNotificationPerm = (await getAppPreference('lastKnownNotificationPermission')) as NotificationPermissionState | null;
    const lastKnownAlarmPerm = (await getAppPreference('lastKnownAlarmPermission')) as AlarmPermissionState | null;

    logger.info(makeLogHeader(LOG_FILE, 'reconcilePermissionsOnForeground'), `Last known permissions - Notification: ${lastKnownNotificationPerm || 'unknown'}, Alarm: ${lastKnownAlarmPerm || 'unknown'}`);

    let didCleanup = false;

    // Check for notification permission transition: granted -> denied
    if (lastKnownNotificationPerm === 'granted' && currentNotificationPerm === 'denied') {
      logger.info(makeLogHeader(LOG_FILE, 'reconcilePermissionsOnForeground'), 'Detected notification permission transition: granted -> denied');
      await cleanupNotificationPermissionRemoved(t);
      didCleanup = true;
    }

    // Check for alarm permission transition: authorized -> denied (only if notifications are still granted)
    if (
      currentNotificationPerm === 'granted' &&
      (lastKnownAlarmPerm === 'authorized' || lastKnownAlarmPerm === null) &&
      currentAlarmPerm === 'denied'
    ) {
      logger.info(makeLogHeader(LOG_FILE, 'reconcilePermissionsOnForeground'), 'Detected alarm permission transition: authorized -> denied');
      await cleanupAlarmPermissionRemoved(t);
      didCleanup = true;
    }

    // Update last-known states
    await setAppPreference('lastKnownNotificationPermission', currentNotificationPerm);
    await setAppPreference('lastKnownAlarmPermission', currentAlarmPerm);

    logger.info(makeLogHeader(LOG_FILE, 'reconcilePermissionsOnForeground'), `Permission reconciliation complete. Did cleanup: ${didCleanup}`);

    return { didCleanup };
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'reconcilePermissionsOnForeground'), 'Failed to reconcile permissions:', error);
    // Don't throw - allow app to continue
    return { didCleanup: false };
  }
}

