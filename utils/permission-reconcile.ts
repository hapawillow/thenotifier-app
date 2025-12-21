import * as Notifications from 'expo-notifications';
import { Alert } from 'react-native';
import { NativeAlarmManager } from 'rn-native-alarmkit';
import { logger, makeLogHeader } from './logger';
import { notificationRefreshEvents } from './notification-refresh-events';
import {
  archiveAllScheduledNotificationsAsCancelled,
  deleteAllScheduledNotifications,
  getAllActiveDailyAlarmInstances,
  getAllScheduledNotificationData,
  getAppPreference,
  markAllDailyAlarmInstancesCancelled,
  markAllDailyAlarmInstancesCancelledForAllNotifications,
  markAllRepeatNotificationInstancesCancelledForAllParents,
  saveAlarmPermissionDenied,
  setAppPreference,
  updateScheduledNotificationData,
} from './database';

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
 * Cancel all AlarmKit alarms for a notification
 */
async function cancelAlarmsForNotification(notificationId: string, repeatOption: string | null, hasAlarm: boolean): Promise<void> {
  if (!hasAlarm) {
    return;
  }

  try {
    if (repeatOption === 'daily') {
      // Cancel all daily alarm instances
      const dailyInstances = await getAllActiveDailyAlarmInstances(notificationId);
      for (const instance of dailyInstances) {
        try {
          await NativeAlarmManager.cancelAlarm(instance.alarmId);
          logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmsForNotification'), `Cancelled daily alarm instance: ${instance.alarmId}`);
        } catch (instanceError: any) {
          const errorMessage = instanceError instanceof Error ? instanceError.message : String(instanceError);
          // Ignore "not found" errors - alarm may have already been cancelled
          if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
            logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmsForNotification'), `Failed to cancel daily alarm instance ${instance.alarmId}:`, instanceError);
          }
        }
      }
      await markAllDailyAlarmInstancesCancelled(notificationId);
      logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmsForNotification'), `Marked all daily alarm instances as cancelled for ${notificationId}`);
    } else {
      // Cancel single alarm (one-time or recurring)
      const alarmId = notificationId.substring('thenotifier-'.length);
      try {
        await NativeAlarmManager.cancelAlarm(alarmId);
        logger.info(makeLogHeader(LOG_FILE, 'cancelAlarmsForNotification'), `Cancelled alarm: ${alarmId}`);
      } catch (alarmError: any) {
        const errorMessage = alarmError instanceof Error ? alarmError.message : String(alarmError);
        // Ignore "not found" errors - alarm may have already been cancelled
        if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
          logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmsForNotification'), `Failed to cancel alarm ${alarmId}:`, alarmError);
        }
      }
    }
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'cancelAlarmsForNotification'), `Failed to cancel alarms for notification ${notificationId}:`, error);
    // Don't throw - continue with other notifications
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
    
    // Cancel all Expo notifications
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      logger.info(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Cancelled all scheduled Expo notifications');
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'cleanupNotificationPermissionRemoved'), 'Failed to cancel all Expo notifications:', error);
      // Continue with DB cleanup even if device cancellation fails
    }

    // Cancel all AlarmKit alarms for scheduled notifications
    for (const notification of scheduledNotifications) {
      await cancelAlarmsForNotification(notification.notificationId, notification.repeatOption, notification.hasAlarm);
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
    // Get all scheduled notifications with alarms
    const scheduledNotifications = await getAllScheduledNotificationData();
    const notificationsWithAlarms = scheduledNotifications.filter(n => n.hasAlarm);

    // Cancel all AlarmKit alarms and update hasAlarm to false
    for (const notification of notificationsWithAlarms) {
      await cancelAlarmsForNotification(notification.notificationId, notification.repeatOption, notification.hasAlarm);
      
      // Update hasAlarm to false in database
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

