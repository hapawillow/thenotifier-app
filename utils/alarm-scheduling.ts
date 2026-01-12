import { Platform } from 'react-native';
import { logger, makeLogHeader } from './logger';
import {
  getRollingWindowSemaphore,
  updateRollingWindowAlarmSemaphore,
  ensureDailyAlarmWindowForAllNotifications,
  // Future: weekly/monthly/yearly alarm maintenance will live here.
} from './database';

const LOG_FILE = 'utils/alarm-scheduling.ts';

export type DeliveryMethod = 'expo' | 'alarm';
export type AlarmScheduleMode = 'relative' | 'fixed';
export type RepeatOption = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type TimeZoneMode = 'dependent' | 'independent';
export type AlarmSource = 'manual' | 'calendar';

export type AlarmData = Readonly<{
  notificationId: string;
  title: string;
  message: string;
  note: string;
  link: string;
}>;

export function buildAlarmData(input: AlarmData): AlarmData {
  // Enforce the “data contract” shape and ensure strings (no undefined/null).
  return {
    notificationId: String(input.notificationId),
    title: String(input.title),
    message: String(input.message),
    note: String(input.note ?? ''),
    link: String(input.link ?? ''),
  };
}

export function buildNotificationDisplayDeepLink(data: AlarmData): string {
  // Notification display expects title/message/note/link as query params.
  const params = new URLSearchParams({
    title: data.title,
    message: data.message,
    note: data.note ?? '',
    link: data.link ?? '',
  });
  return `thenotifier://notification-display?${params.toString()}`;
}

export function decideAlarmScheduleMode(params: {
  source: AlarmSource;
  repeatOption: RepeatOption;
  startDate: Date;
  createdAt: Date;
}): AlarmScheduleMode {
  const { source, repeatOption, startDate, createdAt } = params;

  // Calendar events default to fixed schedule (timezone-independent intent),
  // but the Android implementation determines timebase separately.
  if (source === 'calendar') return 'fixed';

  const diffMs = startDate.getTime() - createdAt.getTime();

  if (repeatOption === 'none') {
    // Prompt: iOS <24h = relative(.never), >=24h = fixed
    return diffMs < 24 * 60 * 60 * 1000 ? 'relative' : 'fixed';
  }

  if (repeatOption === 'daily') {
    return diffMs < 24 * 60 * 60 * 1000 ? 'relative' : 'fixed';
  }

  if (repeatOption === 'weekly') {
    return diffMs < 7 * 24 * 60 * 60 * 1000 ? 'relative' : 'fixed';
  }

  // Monthly/yearly: no rolling window; app-managed next fixed alarm.
  return 'fixed';
}

async function withAlarmMigrationSemaphore<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const nowIso = new Date().toISOString();
  const semaphore = await getRollingWindowSemaphore();

  const last = semaphore?.lastAlarmMigrationAt ? new Date(semaphore.lastAlarmMigrationAt).getTime() : 0;
  const stale = !last || Date.now() - last > 5 * 60 * 1000;
  const canProceed = (semaphore?.activeAlarmMigration ?? 0) === 0 || stale;

  if (!canProceed) {
    logger.info(makeLogHeader(LOG_FILE, 'withAlarmMigrationSemaphore'), 'Alarm migration semaphore is active; skipping this run');
    return;
  }

  await updateRollingWindowAlarmSemaphore(1, nowIso);
  try {
    return await fn();
  } finally {
    await updateRollingWindowAlarmSemaphore(0, new Date().toISOString());
  }
}

/**
 * Replenish alarm windows (rolling-window instance scheduling).
 *
 * Today this wraps existing daily-window logic so we can centralize all alarm upkeep here.
 * As the refactor progresses, weekly and calendar-event alarm maintenance should move here too.
 */
export async function ensureAlarmWindows(): Promise<void> {
  // Daily replenisher currently exists and is used by startup reconcilers.
  await ensureDailyAlarmWindowForAllNotifications();
}

/**
 * Entry point for background/foreground alarm migrations and window upkeep.
 * This is where we will migrate iOS fixed rolling windows -> relative schedules safely.
 */
export async function runAlarmMaintenance(): Promise<void> {
  await withAlarmMigrationSemaphore(async () => {
    // Future: implement actual migration (daily >=24h fixed window -> relative weekly(all-days) once within 24h)
    // Future: weekly >=7d fixed window -> relative weekly(selected day) once within 7d
    // For now, just replenish existing windows.
    await ensureAlarmWindows();
  });
}

export function getAndroidTimeBase(timeZoneMode: TimeZoneMode): 'wallClock' | 'elapsedRealtime' {
  // Prompt: manual alarms are timezone-dependent (wall-clock); calendar events are fixed schedule.
  return timeZoneMode === 'independent' ? 'elapsedRealtime' : 'wallClock';
}

export function getDefaultTimeZoneModeForSource(source: AlarmSource): TimeZoneMode {
  return source === 'calendar' ? 'independent' : 'dependent';
}

export function shouldUseAlarmDelivery(hasAlarmToggle: boolean, alarmSupported: boolean): boolean {
  return hasAlarmToggle && alarmSupported;
}

