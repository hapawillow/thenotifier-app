import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';
import { NativeAlarmManager } from 'notifier-alarm-manager';
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
  rescheduledItems: number;
  cancelledDbRemovedItems: number;
  failures: number;
}

/**
 * Step 1: Cancel platform extras (true orphans)
 * Cancel any scheduled platform notifications/alarms that cannot be attributed to a DB-scheduled parent
 */
async function cancelPlatformOrphans(
  dbScheduledParents: Set<string>
): Promise<{ cancelled: number; failures: number }> {
  let cancelled = 0;
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

    // Cancel orphaned alarms (best-effort DB-driven probing)
    // Since we can't enumerate alarms, we'll rely on DB-driven cancellation in step 3
    // But we can probe for known alarm IDs that shouldn't exist
    for (const parentId of Array.from(dbScheduledParents)) {
      // This will be handled in step 3 (DB-driven cancellation)
    }
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'cancelPlatformOrphans'), 'Failed to cancel platform orphans:', error);
    failures++;
  }

  return { cancelled, failures };
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
    rescheduledItems: 0,
    cancelledDbRemovedItems: 0,
    failures: 0,
  };

  try {
    logger.info(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Starting orphan reconciliation');

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
    const step1Result = await cancelPlatformOrphans(dbParentIds);
    summary.cancelledPlatformOrphans = step1Result.cancelled;
    summary.failures += step1Result.failures;

    // Step 2: Ensure platform matches DB (auto-heal)
    if (notificationPermissionGranted || alarmPermissionAuthorized) {
      const step2Result = await ensurePlatformMatchesDB(
        dbScheduledParents,
        notificationPermissionGranted,
        alarmPermissionAuthorized
      );
      summary.rescheduledItems = step2Result.rescheduled;
      summary.failures += step2Result.failures;
    }

    // Step 3: Cancel platform items that DB says shouldn't exist
    const step3Result = await cancelDbRemovedItems(dbParentIds);
    summary.cancelledDbRemovedItems = step3Result.cancelled;
    summary.failures += step3Result.failures;

    // Log summary
    logger.info(makeLogHeader(LOG_FILE, 'reconcileOrphansOnStartup'), 'Orphan reconciliation complete:', summary);

    // Show alert if mode is 'alert' and actions were taken
    const mode = await getOrphanReconcileMode();
    const hasActions = summary.cancelledPlatformOrphans > 0 || summary.rescheduledItems > 0 || summary.cancelledDbRemovedItems > 0;

    if (mode === 'alert' && hasActions && t) {
      const message = `Reconciled ${summary.cancelledPlatformOrphans + summary.cancelledDbRemovedItems} orphaned items and rescheduled ${summary.rescheduledItems} missing items.`;
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
    const hasActions = summary.cancelledPlatformOrphans > 0 || summary.rescheduledItems > 0;
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

