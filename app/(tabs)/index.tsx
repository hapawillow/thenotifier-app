import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, Dimensions, FlatList, InteractionManager, Platform, Pressable, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native';

import { AppearanceModal } from '@/components/appearance-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { checkCalendarEventChanges } from '@/utils/calendar-check';
import { cancelAlarmKitForParent, cancelExpoForParent } from '@/utils/cancel-scheduling';
import { deleteScheduledNotification, getAllArchivedNotificationData, getAllScheduledNotificationData, getRepeatOccurrencesWithParentMeta, getScheduledNotificationData, insertRepeatOccurrence, markAllRepeatNotificationInstancesCancelled, migrateDailyRollingWindowToNative } from '@/utils/database';
import { useT } from '@/utils/i18n';
import { logger, makeLogHeader } from '@/utils/logger';
import { notificationRefreshEvents } from '@/utils/notification-refresh-events';
import { openNotifierLink } from '@/utils/open-link';
import { formatDateTimeWithTimeZone } from '@/utils/timezone';
import { Toast } from 'toastify-react-native';

const LOG_FILE = 'app/(tabs)/index.tsx';

type ScheduledNotification = {
  id: number;
  notificationId: string;
  title: string;
  message: string;
  note: string;
  link: string;
  scheduleDateTime: string;
  scheduleDateTimeLocal: string;
  repeatOption: string | null;
  notificationTrigger: any; // Notifications.NotificationTriggerInput | undefined
  hasAlarm: boolean;
  calendarId?: string | null;
  originalEventId?: string | null;
  createdTimeZoneId?: string | null;
  createdTimeZoneAbbr?: string | null;
  timeZoneMode?: 'dependent' | 'independent' | null;
  createdAt: string;
  updatedAt: string;
};

type ArchivedNotification = {
  id: number;
  notificationId: string;
  title: string;
  message: string;
  note: string;
  link: string;
  scheduleDateTime: string;
  scheduleDateTimeLocal: string;
  repeatOption: string | null;
  notificationTrigger: any; // Notifications.NotificationTriggerInput | undefined
  hasAlarm: boolean;
  calendarId?: string | null;
  originalEventId?: string | null;
  createdTimeZoneId?: string | null;
  createdTimeZoneAbbr?: string | null;
  timeZoneMode?: 'dependent' | 'independent' | null;
  createdAt: string;
  updatedAt: string;
  handledAt: string | null;
  cancelledAt: string | null;
  archivedAt: string;
};

type RepeatOccurrenceItem = {
  id: number;
  parentNotificationId: string;
  fireDateTime: string;
  recordedAt: string;
  source: string;
  title: string;
  message: string;
  note: string | null;
  link: string | null;
  isRepeatOccurrence: true;
  scheduleDateTime: string; // Added during merge for sorting
  scheduleDateTimeLocal: string; // Added during merge for display
  parentRepeatOption?: string | null; // From parent notification
  parentScheduleDateTime?: string | null; // From parent notification
  parentCreatedTimeZoneId?: string | null; // From parent notification
  parentCreatedTimeZoneAbbr?: string | null; // From parent notification
  parentTimeZoneMode?: string | null; // From parent notification
};

type PastItem = ArchivedNotification | RepeatOccurrenceItem;

// Type guard function
const isRepeatOccurrence = (item: PastItem): item is RepeatOccurrenceItem => {
  return 'isRepeatOccurrence' in item && item.isRepeatOccurrence === true;
};

// Generate stable Past-only key to avoid ID collisions between archived and repeat occurrences
const getPastKey = (item: PastItem): string => {
  return isRepeatOccurrence(item) ? `repeat-${item.id}` : `archived-${item.id}`;
};

type TabType = 'scheduled' | 'archived';

// Debug menu item labels (constants for comparison)
const DEBUG_NOTIFICATIONS_MENU_ITEM = 'Debug: OS Scheduled Notifications';
const DEBUG_ALARMS_MENU_ITEM = 'Debug: Native Scheduled Alarms';

export default function HomeScreen() {
  const router = useRouter();
  const t = useT();

  // Debug menu items (gated by environment variables)
  const showDebugNotificationsMenu = process.env.EXPO_PUBLIC_DEBUG_SCHEDULED_NOTIFICATIONS_MENU === 'true';
  const showDebugAlarmsMenu = process.env.EXPO_PUBLIC_DEBUG_SCHEDULED_ALARMS_MENU === 'true';

  const MENU_ITEMS = [
    t('menuItemText.payments'),
    t('menuItemText.myGroups'),
    t('menuItemText.sendPush'),
    t('menuItemText.help'),
    t('menuItemText.aboutUs'),
    t('menuItemText.appearance'),
    ...(showDebugNotificationsMenu ? [DEBUG_NOTIFICATIONS_MENU_ITEM] : []),
    ...(showDebugAlarmsMenu ? [DEBUG_ALARMS_MENU_ITEM] : []),
  ];
  const [activeTab, setActiveTab] = useState<TabType>('scheduled');
  const [scheduledNotifications, setScheduledNotifications] = useState<ScheduledNotification[]>([]);
  const [archivedNotifications, setArchivedNotifications] = useState<ArchivedNotification[]>([]);
  const [pastItems, setPastItems] = useState<PastItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [animations] = useState<Map<number, Animated.Value>>(new Map());
  const [drawerHeights] = useState<Map<number, number>>(new Map());
  const [buttonHeights] = useState<Map<number, number>>(new Map());
  const [drawerHeightUpdateTrigger, setDrawerHeightUpdateTrigger] = useState(0);

  // Past-only state maps (use string keys to avoid ID collisions between archived and repeat occurrences)
  const [expandedPastKeys, setExpandedPastKeys] = useState<Set<string>>(new Set());
  const [pastAnimations] = useState<Map<string, Animated.Value>>(new Map());
  const [pastDrawerHeights] = useState<Map<string, number>>(new Map());
  const [pastDrawerHeightUpdateTrigger, setPastDrawerHeightUpdateTrigger] = useState(0);
  const [refreshingScheduled, setRefreshingScheduled] = useState(false);
  const [refreshingArchived, setRefreshingArchived] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [appearanceModalVisible, setAppearanceModalVisible] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const loadScheduledNotifications = useCallback(async () => {
    try {
      // Archive past notifications first
      const { archiveScheduledNotifications } = await import('@/utils/database');
      await archiveScheduledNotifications();

      // Small delay to ensure database operations complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Then load the updated list
      const notifications = await getAllScheduledNotificationData();
      setScheduledNotifications(notifications);

      // Initialize animations for new items
      notifications.forEach((item) => {
        if (!animations.has(item.id)) {
          animations.set(item.id, new Animated.Value(0));
        }
      });

      // Don't check calendar changes immediately after loading - it can cause hangs
      // Calendar check will happen on focus via useFocusEffect instead
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'loadScheduledNotifications'), 'Failed to load scheduled notifications:', error);
    }
  }, []);

  const loadArchivedNotifications = async () => {
    try {
      // Load archived one-time notifications
      const archivedData = await getAllArchivedNotificationData();

      // Load repeat occurrences with parent metadata (includes repeatOption and scheduleDateTime)
      const repeatOccurrences = await getRepeatOccurrencesWithParentMeta();

      // Merge into unified PastItem list
      const merged: PastItem[] = [
        ...archivedData.map(item => ({ ...item, isRepeatOccurrence: false as const })),
        ...repeatOccurrences.map(item => ({
          ...item,
          isRepeatOccurrence: true as const,
          // Use fireDateTime as the display time for sorting
          scheduleDateTime: item.fireDateTime,
          scheduleDateTimeLocal: new Date(item.fireDateTime).toLocaleString(),
          // Include parent metadata for displaying repeat info
          parentRepeatOption: item.parentRepeatOption,
          parentScheduleDateTime: item.parentScheduleDateTime,
          parentCreatedTimeZoneId: item.parentCreatedTimeZoneId,
          parentCreatedTimeZoneAbbr: item.parentCreatedTimeZoneAbbr,
          parentTimeZoneMode: item.parentTimeZoneMode,
        })),
      ];

      // Sort by display time DESC (most recent first)
      merged.sort((a, b) => {
        const timeA = isRepeatOccurrence(a) ? a.fireDateTime : a.scheduleDateTime;
        const timeB = isRepeatOccurrence(b) ? b.fireDateTime : b.scheduleDateTime;
        return timeB.localeCompare(timeA);
      });

      setPastItems(merged);
      setArchivedNotifications(archivedData);

      // Initialize Past-only animations for new items (using stable keys)
      merged.forEach((item) => {
        const pastKey = getPastKey(item);
        if (!pastAnimations.has(pastKey)) {
          pastAnimations.set(pastKey, new Animated.Value(0));
        }
      });
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'loadArchivedNotifications'), 'Failed to load archived notifications:', error);
    }
  };

  const loadAllNotifications = async () => {
    await Promise.all([loadScheduledNotifications(), loadArchivedNotifications()]);
  };

  const onRefreshScheduled = useCallback(async () => {
    setRefreshingScheduled(true);
    try {
      await loadScheduledNotifications();
      // Check for calendar event changes after refresh
      setTimeout(() => {
        checkCalendarEventChanges().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE, 'onRefreshScheduled'), 'Failed to check calendar changes:', error);
        });
      }, 500);
    } finally {
      setRefreshingScheduled(false);
    }
  }, []);

  const onRefreshArchived = useCallback(async () => {
    setRefreshingArchived(true);
    await loadArchivedNotifications();
    setRefreshingArchived(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAllNotifications();
      // Don't check calendar changes immediately on focus - delay it significantly
      // to avoid blocking the UI when returning from scheduling a notification
      setTimeout(() => {
        checkCalendarEventChanges().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to check calendar changes:', error);
        });
      }, 2000); // 2 second delay to ensure UI is fully loaded
    }, [])
  );

  useEffect(() => {
    // Refresh when notifications are received
    const unsubscribe = Notifications.addNotificationReceivedListener(async (notification) => {
      // Record repeat occurrence if this is a repeating notification
      try {
        const notificationId = notification.request.identifier;
        // For rolling-window instances, use parentNotificationId from data
        const data = notification.request.content.data;
        const parentId = (data?.notificationId as string) || notificationId;
        const scheduledNotification = await getScheduledNotificationData(parentId);

        if (scheduledNotification && scheduledNotification.repeatOption && scheduledNotification.repeatOption !== 'none') {
          // Compute fireDateTime from notification.date or derive from schedule
          let fireDateTime: string;

          if (notification.date) {
            // Expo notification has date (in seconds, Unix timestamp)
            fireDateTime = new Date(notification.date * 1000).toISOString();
          } else {
            // Android alarm-only mode: notification.date is undefined
            // Derive fire time from schedule or use current time as fallback
            if (Platform.OS === 'android' && scheduledNotification.repeatMethod === 'alarm' && scheduledNotification.repeatOption === 'daily') {
              // For Android daily alarms, try to find the closest scheduled alarm time
              try {
                const { getAllDailyAlarmInstances } = await import('@/utils/database');
                const alarmInstances = await getAllDailyAlarmInstances(parentId);
                const now = new Date();

                // Find the alarm instance that should have fired most recently
                const pastInstances = alarmInstances
                  .map(inst => new Date(inst.fireDateTime))
                  .filter(date => date <= now)
                  .sort((a, b) => b.getTime() - a.getTime()); // Most recent first

                if (pastInstances.length > 0) {
                  // Use the most recent scheduled alarm time
                  fireDateTime = pastInstances[0].toISOString();
                  logger.info(makeLogHeader(LOG_FILE), `[RepeatOccurrence] Derived fireDateTime from alarm instance for ${parentId}: ${fireDateTime}`);
                } else {
                  // Fallback: calculate from scheduleDateTime
                  const scheduleDate = new Date(scheduledNotification.scheduleDateTime);
                  const hour = scheduleDate.getHours();
                  const minute = scheduleDate.getMinutes();
                  const today = new Date();
                  today.setHours(hour, minute, 0, 0);

                  // If today's time has passed, use today; otherwise use yesterday
                  if (today <= now) {
                    fireDateTime = today.toISOString();
                  } else {
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    fireDateTime = yesterday.toISOString();
                  }
                  logger.info(makeLogHeader(LOG_FILE), `[RepeatOccurrence] Calculated fireDateTime from schedule for ${parentId}: ${fireDateTime}`);
                }
              } catch (error) {
                logger.error(makeLogHeader(LOG_FILE), `[RepeatOccurrence] Failed to derive fireDateTime for ${parentId}, using current time:`, error);
                fireDateTime = new Date().toISOString();
              }
            } else {
              // For other cases, calculate from scheduleDateTime + repeat interval
              const now = new Date();
              const scheduleDate = new Date(scheduledNotification.scheduleDateTime);
              const hour = scheduleDate.getHours();
              const minute = scheduleDate.getMinutes();
              const today = new Date();
              today.setHours(hour, minute, 0, 0);

              // If today's time has passed, use today; otherwise use previous occurrence
              if (today <= now) {
                fireDateTime = today.toISOString();
              } else {
                // Calculate previous occurrence based on repeatOption
                const previous = new Date(today);
                switch (scheduledNotification.repeatOption) {
                  case 'daily':
                    previous.setDate(previous.getDate() - 1);
                    break;
                  case 'weekly':
                    previous.setDate(previous.getDate() - 7);
                    break;
                  case 'monthly':
                    previous.setMonth(previous.getMonth() - 1);
                    break;
                  case 'yearly':
                    previous.setFullYear(previous.getFullYear() - 1);
                    break;
                }
                fireDateTime = previous.toISOString();
              }
              logger.info(makeLogHeader(LOG_FILE), `[RepeatOccurrence] Calculated fireDateTime from schedule for ${parentId}: ${fireDateTime}`);
            }
          }

          // Get snapshot from parent notification
          const snapshot = {
            title: scheduledNotification.title,
            message: scheduledNotification.message,
            note: scheduledNotification.note || null,
            link: scheduledNotification.link || null,
          };

          await insertRepeatOccurrence(parentId, fireDateTime, 'foreground', snapshot);
          logger.info(makeLogHeader(LOG_FILE), `[RepeatOccurrence] Recorded foreground occurrence for ${parentId} at ${fireDateTime}`);

          // iOS-only: Migrate daily rolling-window to native daily repeat on first occurrence
          if (scheduledNotification.repeatOption === 'daily' && scheduledNotification.repeatMethod === 'rollingWindow') {
            try {
              await migrateDailyRollingWindowToNative(parentId);
              logger.info(makeLogHeader(LOG_FILE), `[DailyMigration] Triggered migration for ${parentId} on first occurrence (foreground)`);
            } catch (migrationError) {
              logger.error(makeLogHeader(LOG_FILE), `[DailyMigration] Failed to migrate ${parentId}:`, migrationError);
            }
          }
        }
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE), 'Failed to record repeat occurrence from foreground listener:', error);
      }

      // Small delay to ensure database is updated
      setTimeout(() => {
        loadAllNotifications();
      }, 100);
    });
    return () => {
      unsubscribe.remove();
    };
  }, []);

  // Listen for notification refresh events (e.g., after permission cleanup)
  useEffect(() => {
    const unsubscribe = notificationRefreshEvents.subscribe(() => {
      logger.info(makeLogHeader(LOG_FILE), 'Notification refresh event received, reloading scheduled notifications');
      loadScheduledNotifications();
    });
    return () => {
      unsubscribe();
    };
  }, [loadScheduledNotifications]);

  const toggleExpand = (id: number) => {
    const isExpanded = expandedIds.has(id);
    const newExpandedIds = new Set(expandedIds);

    if (isExpanded) {
      newExpandedIds.delete(id);
    } else {
      newExpandedIds.add(id);
    }

    setExpandedIds(newExpandedIds);

    // Animate drawer
    const animValue = animations.get(id) || new Animated.Value(0);
    if (!animations.has(id)) {
      animations.set(id, animValue);
    }

    Animated.timing(animValue, {
      toValue: isExpanded ? 0 : 1,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  // Past-only toggle function (uses string keys to avoid ID collisions)
  const togglePastExpand = (pastKey: string) => {
    const isExpanded = expandedPastKeys.has(pastKey);
    const newExpandedPastKeys = new Set(expandedPastKeys);

    if (isExpanded) {
      newExpandedPastKeys.delete(pastKey);
    } else {
      newExpandedPastKeys.add(pastKey);
    }

    setExpandedPastKeys(newExpandedPastKeys);

    // Animate drawer
    const animValue = pastAnimations.get(pastKey) || new Animated.Value(0);
    if (!pastAnimations.has(pastKey)) {
      pastAnimations.set(pastKey, animValue);
    }

    Animated.timing(animValue, {
      toValue: isExpanded ? 0 : 1,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const handleDelete = async (notification: ScheduledNotification) => {
    Alert.alert(
      t('alertTitles.deleteNotification'),
      t('alertMessages.deleteConfirmation'),
      [
        { text: t('buttonText.cancel'), style: 'cancel' },
        {
          text: t('buttonText.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Cancel all Expo scheduled notifications (main + rolling-window instances)
              await cancelExpoForParent(notification.notificationId);
              logger.info(makeLogHeader(LOG_FILE, 'handleDelete'), 'Cancelled all Expo notifications for:', notification.notificationId);

              // Cancel all AlarmKit alarms (daily and non-daily)
              // Always attempt cancellation regardless of hasAlarm flag (idempotent)
              // Android-only: Use dual-strategy cancellation to handle alarm-only vs notification-only toggle behavior
              if (Platform.OS === 'android') {
                // Cancel using both strategies to avoid repeatOption ambiguity
                // This ensures we catch all alarms regardless of DB state or daily-window instance tracking
                await cancelAlarmKitForParent(notification.notificationId, 'daily');
                await cancelAlarmKitForParent(notification.notificationId, null);
                logger.info(makeLogHeader(LOG_FILE, 'handleDelete'), '[Android] Cancelled all AlarmKit alarms for delete using dual-strategy:', notification.notificationId);
              } else {
                // iOS: Use single-strategy cancellation based on repeatOption
                await cancelAlarmKitForParent(notification.notificationId, notification.repeatOption);
                logger.info(makeLogHeader(LOG_FILE, 'handleDelete'), 'Cancelled all AlarmKit alarms for:', notification.notificationId);
              }

              // Mark rolling-window instances as cancelled in DB (if any)
              const isRollingWindow = notification.notificationTrigger && (notification.notificationTrigger as any).type === 'DATE_WINDOW';
              if (isRollingWindow) {
                await markAllRepeatNotificationInstancesCancelled(notification.notificationId);
                logger.info(makeLogHeader(LOG_FILE, 'handleDelete'), 'Marked all rolling-window notification instances as cancelled on delete');
              }

              // Delete from database
              await deleteScheduledNotification(notification.notificationId);
              // Reload notifications
              await loadAllNotifications();
              // Alert.alert('Success', 'Notification cancelled successfully');

              Toast.show({
                type: 'success',
                text1: t('toastMessages.notificationCancelled'),
                position: 'center',
                visibilityTime: 3000,
                autoHide: true,
                backgroundColor: colors.toastBackground,
                textColor: colors.toastTextColor,
                progressBarColor: colors.toastProgressBar,
                iconColor: colors.toastIconColor,
                iconSize: 24,
              });

            } catch (error) {
              logger.error(makeLogHeader(LOG_FILE, 'handleDelete'), 'Failed to delete notification:', error);
              Alert.alert(t('alertTitles.error'), t('errorMessages.unableToOpenLinkGeneric'));
            }
          },
        },
      ]
    );
  };

  const handleEdit = (notification: ScheduledNotification) => {
    const params = {
      editMode: 'true',
      notificationId: notification.notificationId,
      title: notification.title,
      message: notification.message,
      note: notification.note,
      link: notification.link,
      date: notification.scheduleDateTime,
      repeat: notification.repeatOption || 'none',
      hasAlarm: notification.hasAlarm.toString(),
    };

    router.push({
      pathname: '/schedule/[formId]' as any,
      params: {
        formId: notification.notificationId,
        ...params,
      },
    });
  };

  // Round up a Date to the next minute if it has seconds or milliseconds
  // This ensures times like "3:24:59" display as "3:25" instead of "3:24"
  const roundUpToNextMinute = (date: Date | string): Date => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) {
      return dateObj; // Return invalid date as-is
    }

    const seconds = dateObj.getSeconds();
    const milliseconds = dateObj.getMilliseconds();

    // If there are any seconds or milliseconds, round up to the next minute
    if (seconds > 0 || milliseconds > 0) {
      const timestampMs = dateObj.getTime();
      // Round up: ceil(timestampMs / 60000) * 60000
      const roundedTimestampMs = Math.ceil(timestampMs / 60000) * 60000;
      return new Date(roundedTimestampMs);
    }

    return dateObj;
  };

  // Format date string to remove seconds
  const formatDateTimeWithoutSeconds = (dateTimeString: string): string => {
    try {
      const date = new Date(dateTimeString);
      // If date is invalid, try parsing as locale string
      if (isNaN(date.getTime())) {
        // Try to parse common formats and remove seconds
        // Handle formats like "12/7/2024, 3:45:30 PM"
        return dateTimeString.replace(/:\d{2}(?=\s*(?:AM|PM|$))/i, '');
      }
      // Format without seconds
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (error) {
      // Fallback: try to remove seconds pattern from string
      return dateTimeString.replace(/:\d{2}(?=\s*(?:AM|PM|$))/i, '');
    }
  };

  // Format repeat option text for display
  // Extract time and optional timezone suffix from header display string
  // Example inputs: "1/8/2026, 11:30 AM" or "Jan 8, 2026, 10:45 AM" or "1/8/2026, 11:30 AM (EST)"
  const extractTimeAndTzFromHeader = (text: string): { time: string | null; tzSuffix: string | null } => {
    try {
      // Match time pattern that comes after a comma (date separator)
      // Pattern: ", HH:MM AM/PM" or ", H:MM AM/PM" 
      // This ensures we match the hours:minutes time, not minutes:seconds
      // Also handle cases with seconds: ", 10:45:00 AM" should extract "10:45 AM"
      const timePattern = /,\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i;
      const tzPattern = /\s*\(([^)]+)\)\s*$/;

      const timeMatch = text.match(timePattern);
      const tzMatch = text.match(tzPattern);

      // Combine hours:minutes with AM/PM
      const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3]}` : null;

      return {
        time: time,
        tzSuffix: tzMatch ? tzMatch[1] : null,
      };
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'extractTimeAndTzFromHeader'), 'Error extracting time from header:', error);
      return { time: null, tzSuffix: null };
    }
  };

  const formatRepeatOption = (repeatOption: string | null, scheduleDateTime: string, timeZoneId?: string | null): string => {
    if (!repeatOption || repeatOption === 'none') {
      return '';
    }

    try {
      const date = new Date(scheduleDateTime);
      if (isNaN(date.getTime())) {
        return '';
      }

      // Format options with timezone if provided
      const formatOptions: Intl.DateTimeFormatOptions = timeZoneId ? { timeZone: timeZoneId } : {};

      switch (repeatOption) {
        case 'daily': {
          const timeStr = date.toLocaleString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            ...formatOptions,
          });
          return t('repeatDisplay.repeatsDailyAt', { time: timeStr });
        }
        case 'weekly': {
          const dayOfWeek = date.toLocaleString('en-US', {
            weekday: 'long',
            ...formatOptions,
          });
          return t('repeatDisplay.repeatsWeeklyOn', { day: dayOfWeek });
        }
        case 'monthly': {
          // For monthly, we need to get the day in the correct timezone
          let day: number;
          if (timeZoneId) {
            const formatter = new Intl.DateTimeFormat('en-US', {
              day: 'numeric',
              timeZone: timeZoneId,
            });
            day = parseInt(formatter.format(date), 10);
          } else {
            day = date.getDate();
          }
          const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
          return t('repeatDisplay.repeatsMonthlyOn', { day: String(day), suffix });
        }
        case 'yearly':
          return t('repeatDisplay.repeatsYearly');
        default:
          return '';
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'formatRepeatOption'), 'Error formatting repeat option:', error);
      return '';
    }
  };

  const renderScheduledNotificationItem = ({ item }: { item: ScheduledNotification }) => {
    const isExpanded = expandedIds.has(item.id);
    const animValue = animations.get(item.id) || new Animated.Value(0);

    // Check if notification has expandable content (repeat, note, or link)
    const hasExpandableContent = (item.repeatOption && item.repeatOption !== 'none') || item.note || item.link;

    // Get measured button height, fallback to 64px (accommodates larger text sizes)
    // Ensure minimum of 64px to account for text scaling that might not be captured in measurement
    const measuredButtonHeight = Math.max(buttonHeights.get(item.id) || 0, 56);

    // Calculate dynamic minimum height for message-only notifications
    // paddingTop (16) + marginTop (8) + buttonHeight (measured) + paddingBottom (16)
    const DYNAMIC_MINIMUM_DRAWER_HEIGHT = 16 + 8 + measuredButtonHeight + 16;

    // Use dynamic minimum height as default fallback for message-only notifications, otherwise use 300px
    const defaultFallbackHeight = hasExpandableContent ? 300 : DYNAMIC_MINIMUM_DRAWER_HEIGHT;
    const measuredHeight = drawerHeights.get(item.id) || defaultFallbackHeight;

    const drawerHeight = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, measuredHeight],
    });

    const opacity = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    // Measure drawer content height from an unconstrained hidden view
    // This ensures accurate measurement including blank lines and multi-line text
    const handleMeasurementLayout = (event: any) => {
      const { height } = event.nativeEvent.layout;
      // The measured height already includes padding (16px on all sides)
      // For message-only notifications, enforce dynamic minimum height based on measured button height
      // to ensure buttons are fully visible even with large text sizes
      let finalHeight = height;

      if (!hasExpandableContent) {
        // Use the same measuredButtonHeight value that was used to calculate DYNAMIC_MINIMUM_DRAWER_HEIGHT
        // This ensures consistency between the fallback and the layout handler
        finalHeight = Math.max(height, DYNAMIC_MINIMUM_DRAWER_HEIGHT);
      }

      // Store the height for use in animation
      const currentHeight = drawerHeights.get(item.id);
      if (currentHeight !== finalHeight) {
        drawerHeights.set(item.id, finalHeight);
        // Trigger re-render to update animation with new height
        setDrawerHeightUpdateTrigger(prev => prev + 1);
      }
    };

    // Compute header display string (same as what's shown in dateTimeRow)
    const headerDateTimeText = item.timeZoneMode === 'independent' && item.createdTimeZoneAbbr
      ? formatDateTimeWithTimeZone(item.scheduleDateTime, item.createdTimeZoneId ?? null, item.createdTimeZoneAbbr ?? null)
      : formatDateTimeWithoutSeconds(item.scheduleDateTimeLocal);

    // Extract time and timezone suffix from header string
    const { time: extractedTime, tzSuffix: extractedTzSuffix } = extractTimeAndTzFromHeader(headerDateTimeText);

    // Calculate repeat drawer datetime using same logic as dateTimeRow
    // For timezone-independent: use scheduleDateTime with creation timezone
    // For timezone-dependent: parse scheduleDateTimeLocal to extract time (matches dateTimeRow)
    let repeatDrawerDateTime: string;
    let repeatDrawerTimeZoneId: string | null = null;

    if (item.timeZoneMode === 'independent' && item.createdTimeZoneAbbr) {
      // Timezone-independent: use ISO scheduleDateTime with creation timezone
      repeatDrawerDateTime = item.scheduleDateTime;
      repeatDrawerTimeZoneId = item.createdTimeZoneId ?? null;
    } else {
      // Timezone-dependent: parse scheduleDateTimeLocal to get the same time as dateTimeRow
      // scheduleDateTimeLocal is a locale string like "1/8/2026, 11:30:00 AM"
      // We need to parse it and convert back to ISO for formatRepeatOption
      try {
        const parsedDate = new Date(item.scheduleDateTimeLocal);
        if (!isNaN(parsedDate.getTime())) {
          // Use the parsed date - this preserves the time shown in scheduleDateTimeLocal
          repeatDrawerDateTime = parsedDate.toISOString();
        } else {
          // Fallback to scheduleDateTime if parsing fails
          repeatDrawerDateTime = item.scheduleDateTime;
        }
      } catch (error) {
        // Fallback to scheduleDateTime if parsing fails
        repeatDrawerDateTime = item.scheduleDateTime;
      }
      repeatDrawerTimeZoneId = null; // Device timezone
    }

    // Render drawer content (reused for both measurement and visible drawer)
    const renderDrawerContent = () => (
      <>
        {item.repeatOption && item.repeatOption !== 'none' && (
          <ThemedView style={styles.detailRow}>
            <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.detailLabel}>
              {t('detailLabels.repeat')}
            </ThemedText>
            <ThemedText maxFontSizeMultiplier={1.6} style={styles.detailValue}>
              {(() => {
                // For daily repeats, use extracted time from header to guarantee match
                if (item.repeatOption === 'daily' && extractedTime) {
                  const timeDisplay = extractedTzSuffix
                    ? `${extractedTime} (${extractedTzSuffix})`
                    : extractedTime;
                  return t('repeatDisplay.repeatsDailyAt', { time: timeDisplay });
                }
                // For other repeat types, use existing formatRepeatOption logic
                return formatRepeatOption(item.repeatOption, repeatDrawerDateTime, repeatDrawerTimeZoneId);
              })()}
            </ThemedText>
          </ThemedView>
        )}

        {item.note && (
          <ThemedView style={styles.detailRow}>
            <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.detailLabel}>
              {t('detailLabels.note')}
            </ThemedText>
            <ThemedText maxFontSizeMultiplier={1.6} style={[styles.detailValue, { flexShrink: 1 }]}>
              {item.note}
            </ThemedText>
          </ThemedView>
        )}

        {item.link && (
          <ThemedView style={styles.detailRow}>
            <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.detailLabel}>
              {t('detailLabels.link')}
            </ThemedText>
            <TouchableOpacity
              onPress={() => openNotifierLink(item.link, t)}
              activeOpacity={0.7}>
              <ThemedText
                maxFontSizeMultiplier={1.6}
                style={[styles.detailValue, { color: colors.tint, textDecorationLine: 'underline' }]}
                numberOfLines={1}
                accessibilityRole="link">
                {item.link}
              </ThemedText>
            </TouchableOpacity>
          </ThemedView>
        )}

        <ThemedView style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.deleteButton }]}
            onPress={() => handleDelete(item)}
            activeOpacity={0.7}
            onLayout={(event) => {
              const { height } = event.nativeEvent.layout;
              // Store the measured button height to calculate dynamic minimum drawer height
              // Measure the actual button height (not container) for accurate measurement
              // Ensure minimum of 64px to account for text scaling
              const measuredHeight = Math.max(height, 56);
              const currentButtonHeight = buttonHeights.get(item.id);
              // Only update if height is valid and different, or if we don't have a measurement yet
              if (measuredHeight > 0 && currentButtonHeight !== measuredHeight) {
                buttonHeights.set(item.id, measuredHeight);

                // For message-only notifications, immediately recalculate drawer height
                if (!hasExpandableContent) {
                  const dynamicMinimum = 16 + 8 + measuredHeight + 16;
                  const currentDrawerHeight = drawerHeights.get(item.id);
                  // Always update if we don't have a drawer height, or if current is less than minimum
                  if (!currentDrawerHeight || currentDrawerHeight < dynamicMinimum) {
                    drawerHeights.set(item.id, dynamicMinimum);
                    // Trigger re-render to update drawer height calculation
                    setDrawerHeightUpdateTrigger(prev => prev + 1);
                  } else {
                    // Even if drawer height is already set, trigger re-render to ensure consistency
                    setDrawerHeightUpdateTrigger(prev => prev + 1);
                  }
                } else {
                  // Trigger re-render even for expandable content to ensure button height is stored
                  setDrawerHeightUpdateTrigger(prev => prev + 1);
                }
              }
            }}>
            <IconSymbol name="trash" size={20} color={colors.deleteButtonText} />
            <ThemedText maxFontSizeMultiplier={1.3} style={[styles.actionButtonText, { color: colors.deleteButtonText }]}>{t('buttonText.delete')}</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.tint }]}
            onPress={() => handleEdit(item)}
            activeOpacity={0.7}>
            <IconSymbol name="pencil" size={20} color={colors.buttonText} />
            <ThemedText maxFontSizeMultiplier={1.3} style={[styles.actionButtonText, { color: colors.buttonText }]}>{t('buttonText.edit')}</ThemedText>
          </TouchableOpacity>
        </ThemedView>
      </>
    );

    return (
      <ThemedView style={[styles.notificationItem, { borderColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={styles.notificationHeader}
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.7}>
          <ThemedView style={styles.notificationContent}>
            <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.title}>
              {item.title}
            </ThemedText>
            <ThemedText maxFontSizeMultiplier={1.6} style={styles.message} numberOfLines={2}>
              {item.message}
            </ThemedText>
            <ThemedView style={styles.dateTimeRow}>
              <ThemedText maxFontSizeMultiplier={1.6} style={styles.message} numberOfLines={1}>
                {item.timeZoneMode === 'independent' && item.createdTimeZoneAbbr
                  ? formatDateTimeWithTimeZone(item.scheduleDateTime, item.createdTimeZoneId ?? null, item.createdTimeZoneAbbr ?? null)
                  : formatDateTimeWithoutSeconds(item.scheduleDateTimeLocal)}
              </ThemedText>
              {item.hasAlarm && (
                <IconSymbol
                  name="bell.fill"
                  size={16}
                  color={colors.icon}
                  style={styles.icon}
                />
              )}
              {item.repeatOption && item.repeatOption !== 'none' && (
                <IconSymbol
                  name="repeat"
                  size={16}
                  color={colors.icon}
                  style={styles.icon}
                />
              )}
            </ThemedView>
          </ThemedView>
          <IconSymbol
            name={isExpanded ? 'chevron.up' : 'chevron.down'}
            size={24}
            color={colors.icon}
          />
        </TouchableOpacity>

        {/* Hidden measurement view - measures content height without animation constraints */}
        <ThemedView
          style={[
            styles.drawerContent,
            styles.measurementView,
          ]}
          onLayout={handleMeasurementLayout}
          pointerEvents="none">
          {renderDrawerContent()}
        </ThemedView>

        {/* Visible animated drawer */}
        <Animated.View
          style={[
            styles.drawer,
            {
              height: drawerHeight,
              opacity: opacity,
              overflow: 'hidden',
              borderTopColor: colors.icon + '40',
            },
          ]}>
          <ThemedView style={styles.drawerContent}>
            {renderDrawerContent()}
          </ThemedView>
        </Animated.View>
      </ThemedView>
    );
  };

  const renderArchivedNotificationItem = ({ item }: { item: PastItem }) => {
    // Use Past-only stable key to avoid ID collisions
    const pastKey = getPastKey(item);
    const isExpanded = expandedPastKeys.has(pastKey);
    const animValue = pastAnimations.get(pastKey) || new Animated.Value(0);

    // Handle repeat occurrences differently
    const isRepeat = isRepeatOccurrence(item);
    const displayTitle = item.title;
    const displayMessage = item.message;
    const displayNote = item.note;
    const displayLink = item.link;
    // For repeat drawer, use the same datetime that's displayed in dateTimeRow
    // For repeat occurrences, use fireDateTime; for archived, use scheduleDateTime
    const displayDateTime = isRepeat ? item.fireDateTime : item.scheduleDateTime;
    // For repeat occurrences, check if parent is timezone-independent
    const parentTimeZoneMode = isRepeat ? (item as any).parentTimeZoneMode : (item as ArchivedNotification).timeZoneMode;
    const parentCreatedTimeZoneId = isRepeat ? (item as any).parentCreatedTimeZoneId : (item as ArchivedNotification).createdTimeZoneId;
    const parentCreatedTimeZoneAbbr = isRepeat ? (item as any).parentCreatedTimeZoneAbbr : (item as ArchivedNotification).createdTimeZoneAbbr;

    let displayDateTimeLocal: string;
    // Compute header display string (same as what's shown in dateTimeRow)
    if (isRepeat && parentTimeZoneMode === 'independent' && parentCreatedTimeZoneAbbr) {
      // Format repeat occurrence in parent's creation timezone
      // Round up to next minute to ensure seconds like ":59" display as next minute
      const roundedFireDateTime = roundUpToNextMinute(item.fireDateTime);
      displayDateTimeLocal = formatDateTimeWithTimeZone(roundedFireDateTime.toISOString(), parentCreatedTimeZoneId ?? null, parentCreatedTimeZoneAbbr ?? null);
    } else if (!isRepeat && parentTimeZoneMode === 'independent' && parentCreatedTimeZoneAbbr) {
      // Format archived notification with timezone using ISO timestamp
      // Round up to next minute to ensure seconds like ":59" display as next minute
      const roundedScheduleDateTime = roundUpToNextMinute(item.scheduleDateTime);
      displayDateTimeLocal = formatDateTimeWithTimeZone(roundedScheduleDateTime.toISOString(), parentCreatedTimeZoneId ?? null, parentCreatedTimeZoneAbbr ?? null);
    } else {
      // Default: no timezone suffix
      displayDateTimeLocal = isRepeat ? new Date(item.fireDateTime).toLocaleString() : item.scheduleDateTimeLocal;
    }

    // Extract time and timezone suffix from header string (for daily repeats)
    const { time: extractedTime, tzSuffix: extractedTzSuffix } = extractTimeAndTzFromHeader(displayDateTimeLocal);

    // For repeat drawer formatting, use the same datetime source as dateTimeRow
    let repeatDrawerDateTime: string; // ISO string for formatRepeatOption
    let repeatDrawerTimeZoneId: string | null = null; // Timezone ID for formatRepeatOption
    if (isRepeat && parentTimeZoneMode === 'independent' && parentCreatedTimeZoneAbbr) {
      // Round up to next minute for consistency with header display
      const roundedFireDateTime = roundUpToNextMinute(item.fireDateTime);
      repeatDrawerDateTime = roundedFireDateTime.toISOString(); // Use rounded fireDateTime ISO string
      repeatDrawerTimeZoneId = parentCreatedTimeZoneId ?? null; // Use parent's creation timezone
    } else if (!isRepeat && parentTimeZoneMode === 'independent' && parentCreatedTimeZoneAbbr) {
      // Round up to next minute for consistency with header display
      const roundedScheduleDateTime = roundUpToNextMinute(item.scheduleDateTime);
      repeatDrawerDateTime = roundedScheduleDateTime.toISOString(); // Use rounded scheduleDateTime ISO string
      repeatDrawerTimeZoneId = parentCreatedTimeZoneId ?? null; // Use creation timezone
    } else {
      // For formatRepeatOption, use ISO strings
      repeatDrawerDateTime = isRepeat ? item.fireDateTime : item.scheduleDateTime;
      repeatDrawerTimeZoneId = null; // Use device timezone
    }
    const hasAlarm = isRepeat ? false : item.hasAlarm;

    // For repeat occurrences, get repeat metadata from item (will be populated by DB query)
    // For archived items, use item.repeatOption directly
    const repeatOption = isRepeat ? (item as any).parentRepeatOption : item.repeatOption;
    const parentScheduleDateTime = isRepeat ? (item as any).parentScheduleDateTime : item.scheduleDateTime;

    // Check if item has any expandable content (repeat option, note, or link)
    const hasRepeatOption = repeatOption && repeatOption !== 'none';
    const hasNote = displayNote && displayNote.trim().length > 0;
    const hasLink = displayLink && displayLink.trim().length > 0;
    const hasExpandableContent = hasRepeatOption || hasNote || hasLink;

    // Calculate minimum height for drawer content
    // paddingTop (16) + detailRow (label ~22px + gap 4px + value ~22px) + paddingBottom (16) = ~80px minimum
    // Add extra space for multiple rows or larger text
    const MINIMUM_DRAWER_HEIGHT = 80;
    const defaultFallbackHeight = hasExpandableContent ? Math.max(250, MINIMUM_DRAWER_HEIGHT) : 0;
    const measuredHeight = pastDrawerHeights.get(pastKey) || defaultFallbackHeight;

    const drawerHeight = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, measuredHeight],
    });

    const opacity = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    // Measure drawer content height from an unconstrained hidden view
    // This ensures accurate measurement including blank lines and multi-line text
    const handleMeasurementLayout = (event: any) => {
      const { height } = event.nativeEvent.layout;
      // The measured height already includes padding (16px on all sides)
      // Enforce minimum height when there's expandable content to prevent drawer from collapsing too small
      const finalHeight = hasExpandableContent ? Math.max(height, MINIMUM_DRAWER_HEIGHT) : height;

      // Store the height for use in animation (using Past-only key)
      const currentHeight = pastDrawerHeights.get(pastKey);
      if (currentHeight !== finalHeight) {
        pastDrawerHeights.set(pastKey, finalHeight);
        // Trigger re-render to update animation with new height
        setPastDrawerHeightUpdateTrigger(prev => prev + 1);
      }
    };

    // Render drawer content (reused for both measurement and visible drawer)
    const renderDrawerContent = () => (
      <>
        {hasRepeatOption && (
          <ThemedView style={styles.detailRow}>
            <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.detailLabel}>
              {t('detailLabels.repeat')}
            </ThemedText>
            <ThemedText maxFontSizeMultiplier={1.6} style={styles.detailValue}>
              {(() => {
                // For daily repeats, use extracted time from header to guarantee match
                if (repeatOption === 'daily' && extractedTime) {
                  const timeDisplay = extractedTzSuffix
                    ? `${extractedTime} (${extractedTzSuffix})`
                    : extractedTime;
                  return t('repeatDisplay.repeatsDailyAt', { time: timeDisplay });
                }
                // For other repeat types, use existing formatRepeatOption logic
                return formatRepeatOption(repeatOption!, repeatDrawerDateTime, repeatDrawerTimeZoneId);
              })()}
            </ThemedText>
          </ThemedView>
        )}

        {hasNote && (
          <ThemedView style={styles.detailRow}>
            <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.detailLabel}>
              {t('detailLabels.note')}
            </ThemedText>
            <ThemedText maxFontSizeMultiplier={1.6} style={[styles.detailValue, { flexShrink: 1 }]}>
              {displayNote}
            </ThemedText>
          </ThemedView>
        )}

        {hasLink && (
          <ThemedView style={styles.detailRow}>
            <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.detailLabel}>
              {t('detailLabels.link')}
            </ThemedText>
            <TouchableOpacity
              onPress={() => openNotifierLink(displayLink!, t)}
              activeOpacity={0.7}>
              <ThemedText
                maxFontSizeMultiplier={1.6}
                style={[styles.detailValue, { color: colors.tint, textDecorationLine: 'underline' }]}
                numberOfLines={1}
                accessibilityRole="link">
                {displayLink}
              </ThemedText>
            </TouchableOpacity>
          </ThemedView>
        )}
      </>
    );

    const headerContent = (
      <>
        <ThemedView style={styles.notificationContent}>
          <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.title}>
            {displayTitle}
          </ThemedText>
          <ThemedText maxFontSizeMultiplier={1.6} style={styles.message} numberOfLines={2}>
            {displayMessage}
          </ThemedText>
          <ThemedView style={styles.dateTimeRow}>
            <ThemedText maxFontSizeMultiplier={1.6} style={styles.message} numberOfLines={1}>
              {parentTimeZoneMode === 'independent' && parentCreatedTimeZoneAbbr
                ? displayDateTimeLocal // Already formatted with timezone, don't re-parse
                : formatDateTimeWithoutSeconds(displayDateTimeLocal)}
            </ThemedText>
            {hasAlarm && (
              <IconSymbol
                name="bell.fill"
                size={16}
                color={colors.icon}
                style={styles.icon}
              />
            )}
            {(isRepeat || hasRepeatOption) && (
              <IconSymbol
                name="repeat"
                size={16}
                color={colors.icon}
                style={styles.icon}
              />
            )}
          </ThemedView>
        </ThemedView>
        {hasExpandableContent && (
          <IconSymbol
            name={isExpanded ? 'chevron.up' : 'chevron.down'}
            size={24}
            color={colors.icon}
          />
        )}
      </>
    );

    return (
      <ThemedView style={[styles.notificationItem, { borderColor: colors.icon + '40' }]}>
        {hasExpandableContent ? (
          <TouchableOpacity
            style={styles.notificationHeader}
            onPress={() => togglePastExpand(pastKey)}
            activeOpacity={0.7}>
            {headerContent}
          </TouchableOpacity>
        ) : (
          <ThemedView style={styles.notificationHeader}>
            {headerContent}
          </ThemedView>
        )}

        {hasExpandableContent && (
          <>
            {/* Hidden measurement view - measures content height without animation constraints */}
            <ThemedView
              style={[
                styles.drawerContent,
                styles.measurementView,
              ]}
              onLayout={handleMeasurementLayout}
              pointerEvents="none">
              {renderDrawerContent()}
            </ThemedView>

            {/* Visible animated drawer */}
            <Animated.View
              style={[
                styles.drawer,
                {
                  height: drawerHeight,
                  opacity: opacity,
                  overflow: 'hidden',
                  borderTopColor: colors.icon + '40',
                },
              ]}>
              <ThemedView style={styles.drawerContent}>
                {renderDrawerContent()}
              </ThemedView>
            </Animated.View>
          </>
        )}
      </ThemedView>
    );
  };

  const handleMenuToggle = () => {
    setMenuOpen((prev) => !prev);
  };

  const handleMenuSelect = (item: string) => {
    setMenuOpen(false);
    if (item === t('menuItemText.aboutUs')) {
      router.push('/about');
    } else if (item === t('menuItemText.appearance')) {
      setAppearanceModalVisible(true);
    } else if (item === DEBUG_NOTIFICATIONS_MENU_ITEM) {
      router.push('/debug/os-scheduled-notifications');
    } else if (item === DEBUG_ALARMS_MENU_ITEM) {
      router.push('/debug/native-alarms');
    } else {
      // Use InteractionManager to ensure Alert shows after interactions complete
      InteractionManager.runAfterInteractions(() => {
        Alert.alert(t('alertTitles.menu'), t('menuSelected', { item }));
      });
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedView style={styles.headerContent}>
          <ThemedView style={styles.headerSpacer} />
          <TouchableOpacity
            onPress={handleMenuToggle}
            activeOpacity={0.7}
            style={styles.menuButton}>
            <IconSymbol
              name="ellipsis.circle"
              size={28}
              color={colors.icon}
            />
          </TouchableOpacity>
        </ThemedView>
      </ThemedView>

      {menuOpen && (
        <>
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => setMenuOpen(false)}
          />
          <ThemedView style={[styles.menuCard, { backgroundColor: colors.background, borderColor: colors.icon + '40' }]}>
            {MENU_ITEMS.map((item, index) => (
              <TouchableOpacity
                key={item}
                onPress={() => handleMenuSelect(item)}
                activeOpacity={0.7}
                style={[
                  styles.menuItem,
                  index < MENU_ITEMS.length - 1
                    ? { borderBottomColor: colors.icon + '20', borderBottomWidth: 1 }
                    : { borderBottomWidth: 0 },
                ]}>
                <ThemedText maxFontSizeMultiplier={1.4} style={styles.menuItemText}>
                  {item}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </ThemedView>
        </>
      )}

      <ThemedView style={[styles.tabContainer, { borderBottomColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'scheduled' && [styles.activeTab, { borderBottomColor: colors.tint }],
          ]}
          onPress={() => setActiveTab('scheduled')}
          activeOpacity={0.7}>
          <ThemedText
            type="defaultSemiBold"
            maxFontSizeMultiplier={1.4}
            style={[
              styles.tabText,
              activeTab === 'scheduled' && { color: colors.tint },
            ]}>
            {t('tabBarText.upcoming')}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'archived' && [styles.activeTab, { borderBottomColor: colors.tint }],
          ]}
          onPress={() => setActiveTab('archived')}
          activeOpacity={0.7}>
          <ThemedText
            type="defaultSemiBold"
            maxFontSizeMultiplier={1.4}
            style={[
              styles.tabText,
              activeTab === 'archived' && { color: colors.tint },
            ]}>
            {t('tabBarText.past')}
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>

      {activeTab === 'scheduled' ? (
        <FlatList
          data={scheduledNotifications}
          renderItem={renderScheduledNotificationItem}
          keyExtractor={(item) => item.notificationId}
          contentContainerStyle={
            scheduledNotifications.length === 0
              ? styles.emptyListContent
              : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          scrollEnabled={true}
          alwaysBounceVertical={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshingScheduled}
              onRefresh={onRefreshScheduled}
              tintColor={colors.tint}
              colors={[colors.tint]}
            />
          }
          ListEmptyComponent={
            <ThemedView style={styles.emptyContainer}>
              <ThemedText style={styles.emptyText}>
                {t('emptyStates.noUpcomingNotifications')}
              </ThemedText>
            </ThemedView>
          }
        />
      ) : (
        <FlatList
          data={pastItems}
          renderItem={renderArchivedNotificationItem}
          keyExtractor={(item) => isRepeatOccurrence(item) ? `repeat-${item.id}` : item.notificationId}
          contentContainerStyle={
            pastItems.length === 0
              ? styles.emptyListContent
              : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          scrollEnabled={true}
          alwaysBounceVertical={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshingArchived}
              onRefresh={onRefreshArchived}
              tintColor={colors.tint}
              colors={[colors.tint]}
            />
          }
          ListEmptyComponent={
            <ThemedView style={styles.emptyContainer}>
              <ThemedText style={styles.emptyText}>
                {t('emptyStates.noSentNotifications')}
              </ThemedText>
            </ThemedView>
          }
        />
      )}
      <AppearanceModal
        visible={appearanceModalVisible}
        onClose={() => setAppearanceModalVisible(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    marginTop: 40,
    padding: 20,
    paddingBottom: 10,
    position: 'relative',
    zIndex: 1,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  headerSpacer: {
    flex: 1,
  },
  menuButton: {
    padding: 4,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  menuCard: {
    position: 'absolute',
    // NOTE: previously this menu was positioned relative to the header.
    // Now it's rendered at the screen root so it can sit above the backdrop on Android.
    top: 100,
    right: 20,
    borderRadius: 12,
    minWidth: 180,
    zIndex: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
    borderWidth: 1,
  },
  menuItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: 16,
  },
  tabContainer: {
    flexDirection: 'row',
    // borderBottomWidth: 1,
    marginBottom: 15,
  },
  tab: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 18,
  },
  listContent: {
    padding: 20,
    paddingTop: 0,
    flexGrow: 1,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    minHeight: Dimensions.get('window').height - 200, // Ensure enough height for pull-to-refresh
  },
  notificationItem: {
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  notificationContent: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    marginBottom: 4,
  },
  message: {
    fontSize: 18,
    opacity: 0.8,
  },
  drawer: {
    borderTopWidth: 1,
  },
  drawerContent: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  measurementView: {
    position: 'absolute',
    opacity: 0,
    width: '100%',
    zIndex: -1,
  },
  detailRow: {
    gap: 4,
  },
  detailLabel: {
    fontSize: 18,
    opacity: 0.7,
  },
  detailValue: {
    fontSize: 18,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 50,
    gap: 8,
  },
  actionButtonText: {
    color: '#8ddaff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    opacity: 0.6,
  },
  dateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    marginLeft: 4,
  },
});
