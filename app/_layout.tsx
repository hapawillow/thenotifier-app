import { AppearanceProvider } from '@/components/appearance-provider';
import { CalendarChangeModal } from '@/components/calendar-change-modal';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ChangedCalendarEvent, checkCalendarEventChanges } from '@/utils/calendar-check';
import { calendarCheckEvents } from '@/utils/calendar-check-events';
import { archiveScheduledNotifications, ensureDailyAlarmWindowForAllNotifications, ensureRollingWindowNotificationInstances, getAppLanguage, getOrCreateDeviceId, getScheduledNotificationData, initDatabase, insertRepeatOccurrence, migrateDailyRollingWindowToNative, migrateRollingWindowRepeatsToExpo, updateArchivedNotificationData } from '@/utils/database';
import { I18nProvider, initI18n, translate } from '@/utils/i18n';
import { logger, makeLogHeader } from '@/utils/logger';
import { ensureAndroidNotificationChannel } from '@/utils/notification-channel';
import { reconcileOrphansOnForeground, reconcileOrphansOnStartup } from '@/utils/orphan-reconcile';
import { reconcilePermissionsOnForeground } from '@/utils/permission-reconcile';
import { ensurePushTokensUpToDate } from '@/utils/push-tokens';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { EventSubscription } from 'expo-modules-core';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { NativeAlarmManager } from 'notifier-alarm-manager';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';
import { KeyboardProvider } from "react-native-keyboard-controller";
import 'react-native-reanimated';
import ToastManager from 'toastify-react-native';
import appJson from '../app.json';

const LOG_FILE = 'app/_layout.tsx';


// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const responseListener = useRef<EventSubscription | null>(null);
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  const handledNotificationsRef = useRef<Set<string>>(new Set());
  const pendingNavTimeoutRef = useRef<NodeJS.Timeout | number | null>(null);
  const navigationCooldownRef = useRef<Map<string, number>>(new Map());
  const lastProcessedResponseKeyRef = useRef<string | null>(null);
  const awaitingInitialResponseRef = useRef<boolean>(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | number | null>(null);
  const pendingDeepLinkUrlRef = useRef<string | null>(null);
  const lastHandledDeepLinkRef = useRef<{ url: string; at: number } | null>(null);
  const [changedEvents, setChangedEvents] = useState<ChangedCalendarEvent[]>([]);
  const [showCalendarChangeModal, setShowCalendarChangeModal] = useState(false);
  const lastCheckTimeRef = useRef<number>(0);
  const [i18nLoaded, setI18nLoaded] = useState(false);
  const [i18nLang, setI18nLang] = useState<string>('en');
  const [i18nVersion, setI18nVersion] = useState<string>('1.0.0');
  const [i18nPack, setI18nPack] = useState<any>(null);
  const [loaded] = useFonts({
    InterRegular: require('../assets/fonts/Inter_18pt-Regular.ttf'),
    InterItalic: require('../assets/fonts/Inter_18pt-Italic.ttf'),
    InterBold: require('../assets/fonts/Inter_18pt-Bold.ttf'),
    InterBoldItalic: require('../assets/fonts/Inter_18pt-BoldItalic.ttf'),
    FiraSansRegular: require('../assets/fonts/FiraSans-Regular.ttf'),
    FiraSansBold: require('../assets/fonts/FiraSans-Bold.ttf'),
    FiraSansBoldItalic: require('../assets/fonts/FiraSans-BoldItalic.ttf'),
    FiraSansBlack: require('../assets/fonts/FiraSans-Black.ttf'),
    FiraSansBlackItalic: require('../assets/fonts/FiraSans-BlackItalic.ttf'),
  });

  const handleDeepLinkNavigation = useCallback(async (url: string, isColdStart: boolean = false) => {
    try {
      if (!url) return;

      const parsed = Linking.parse(url);
      // For custom schemes like thenotifier://notification-display?... the route can appear as hostname.
      const routeKey = String(parsed.path || parsed.hostname || '');

      logger.info(makeLogHeader(LOG_FILE, 'handleDeepLinkNavigation'), 'Deep link received:', {
        url,
        parsed,
        routeKey,
        isColdStart,
        loaded,
        i18nLoaded,
        hasI18nPack: !!i18nPack,
      });

      if (routeKey !== 'notification-display') {
        return;
      }

      // Dedupe to avoid reopen loops
      const now = Date.now();
      const last = lastHandledDeepLinkRef.current;
      if (last && last.url === url && (now - last.at) < 5000) {
        logger.info(makeLogHeader(LOG_FILE, 'handleDeepLinkNavigation'), 'Deep link cooldown active, skipping');
        return;
      }

      if (!loaded || !i18nLoaded || !i18nPack) {
        pendingDeepLinkUrlRef.current = url;
        logger.info(makeLogHeader(LOG_FILE, 'handleDeepLinkNavigation'), 'App not ready; deferring deep link handling');
        return;
      }

      lastHandledDeepLinkRef.current = { url, at: now };

      const params = (parsed.queryParams || {}) as Record<string, any>;
      const normalize = (v: any) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''));

      // Cold start: use replace to override the default route stack
      const nav = {
        pathname: '/notification-display' as const,
        params: {
          title: normalize(params.title),
          message: normalize(params.message),
          note: normalize(params.note),
          link: normalize(params.link),
        },
      };

      if (isColdStart) {
        router.replace(nav);
      } else {
        router.push(nav);
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'handleDeepLinkNavigation'), 'Failed to handle deep link:', error);
    }
  }, [router, loaded, i18nLoaded, i18nPack]);

  // Deep link handling (cold start + runtime)
  useEffect(() => {
    let isMounted = true;

    Linking.getInitialURL()
      .then((url) => {
        if (!isMounted || !url) return;
        logger.info(makeLogHeader(LOG_FILE, 'deepLink'), 'Initial URL:', url);
        handleDeepLinkNavigation(url, true);
      })
      .catch((error) => {
        logger.error(makeLogHeader(LOG_FILE, 'deepLink'), 'Failed to get initial URL:', error);
      });

    const sub = Linking.addEventListener('url', (event) => {
      if (!event?.url) return;
      logger.info(makeLogHeader(LOG_FILE, 'deepLink'), 'URL event:', event.url);
      handleDeepLinkNavigation(event.url, false);
    });

    return () => {
      isMounted = false;
      sub.remove();
    };
  }, [handleDeepLinkNavigation]);

  // Listen for deep link requests coming from native alarm UI (iOS AlarmKit / Android alarms).
  useEffect(() => {
    const unsubscribe = NativeAlarmManager.onDeepLink?.((event: any) => {
      const url = event?.url;
      if (typeof url === 'string' && url.length > 0) {
        logger.info(makeLogHeader(LOG_FILE, 'deepLink'), 'Received deep link event from native alarms:', url);
        handleDeepLinkNavigation(url, false);
      }
    });

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, [handleDeepLinkNavigation]);

  // Helper function to handle notification navigation
  const handleNotificationNavigation = useCallback(async (notification: Notifications.Notification, actionIdentifier: string, isColdStart: boolean = false) => {
    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Notification received:', notification);
    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Action identifier:', actionIdentifier);

    const notificationId = notification.request.identifier;
    const data = notification.request.content.data;

    // Compute dedupe key: use parent notification ID if available (for repeat notifications),
    // otherwise fall back to the instance identifier
    const parentId = (data?.notificationId as string) || null;
    const dedupeKey = parentId || notificationId;

    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Notification ID:', notificationId);
    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Parent ID:', parentId);
    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Dedupe key:', dedupeKey);
    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: App state:', AppState.currentState);

    // CRITICAL: Check dedupe key FIRST before any async operations
    // This prevents multiple calls from processing the same notification
    if (handledNotificationsRef.current.has(dedupeKey)) {
      logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Notification already handled (dedupe key), skipping...');
      return;
    }

    // Check cooldown: ignore if we've navigated for this dedupe key within the last 5 seconds
    // Increased to 5 seconds to be very conservative and prevent any reopen loops
    const now = Date.now();
    const lastNavTime = navigationCooldownRef.current.get(dedupeKey);
    if (lastNavTime && (now - lastNavTime) < 5000) {
      logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Navigation cooldown active, skipping navigation...');
      return;
    }

    // Only navigate if user tapped the notification (not dismissed it)
    if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {

      // Mark as handled NOW - just before we start processing the navigation
      // This is done here instead of at the top to ensure we don't mark it handled too early
      // (e.g., before dev menu is dismissed on cold start)
      handledNotificationsRef.current.add(dedupeKey);
      handledNotificationsRef.current.add(notificationId);
      logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Marked notification as handled');

      // Check if we need to archive any scheduled notifications
      try {
        await archiveScheduledNotifications();
      } catch (error) {
        // Error already logged in archiveScheduledNotifications, just prevent uncaught rejection
        logger.error(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'Failed to archive notifications:', error);
      }

      logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Data:', data);

      // Record repeat occurrence if this is a repeating notification
      try {
        // For rolling-window instances, use parentNotificationId from data
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
                  logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `[RepeatOccurrence] Derived fireDateTime from alarm instance for ${parentId}: ${fireDateTime}`);
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
                  logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `[RepeatOccurrence] Calculated fireDateTime from schedule for ${parentId}: ${fireDateTime}`);
                }
              } catch (error) {
                logger.error(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `[RepeatOccurrence] Failed to derive fireDateTime for ${parentId}, using current time:`, error);
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
              logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `[RepeatOccurrence] Calculated fireDateTime from schedule for ${parentId}: ${fireDateTime}`);
            }
          }

          // Get snapshot from parent notification
          const snapshot = {
            title: scheduledNotification.title,
            message: scheduledNotification.message,
            note: scheduledNotification.note || null,
            link: scheduledNotification.link || null,
          };

          await insertRepeatOccurrence(parentId, fireDateTime, 'tap', snapshot);
          logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `[RepeatOccurrence] Recorded tap occurrence for ${parentId} at ${fireDateTime}`);

          // iOS-only: Migrate daily rolling-window to native daily repeat on first occurrence
          if (scheduledNotification.repeatOption === 'daily' && scheduledNotification.repeatMethod === 'rollingWindow') {
            try {
              await migrateDailyRollingWindowToNative(parentId);
              logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `[DailyMigration] Triggered migration for ${parentId} on first occurrence`);
            } catch (migrationError) {
              logger.error(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `[DailyMigration] Failed to migrate ${parentId}:`, migrationError);
            }
          }
        }
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Failed to record repeat occurrence:', error);
      }

      // Navigate if notification has content (title/body) and data (note/link)
      if (notification.request.content.title || notification.request.content.body) {
        logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Navigating to notification display with title:', notification.request.content.title);
        try {
          await updateArchivedNotificationData(notificationId);
          logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Archived notification data updated successfully');
        } catch (e) {
          logger.error(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Failed to update archived notification data:', e);
        }

        // Clear any pending navigation timeout to prevent multiple pushes
        if (pendingNavTimeoutRef.current) {
          clearTimeout(pendingNavTimeoutRef.current as NodeJS.Timeout);
          pendingNavTimeoutRef.current = null;
          logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Cleared pending navigation timeout');
        }

        // Update cooldown timestamp BEFORE navigation to prevent rapid re-navigation
        navigationCooldownRef.current.set(dedupeKey, Date.now());

        // Small delay to ensure navigation is ready
        // On cold start, use router.replace() to override the default (tabs) route
        // On foreground/background, use router.push() for proper modal presentation
        // Increased cold start delay to 1000ms to ensure router is fully committed to initial route
        const navDelay = isColdStart ? 1000 : 100;
        const navigationMethod = isColdStart ? 'replace' : 'push';

        pendingNavTimeoutRef.current = setTimeout(() => {
          logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `handleNotificationNavigation: Executing router.${navigationMethod} to notification-display (coldStart: ${isColdStart})`);

          const navigationParams = {
            pathname: '/notification-display' as const,
            params: {
              title: notification.request.content.title || '',
              message: notification.request.content.body || '',
              note: (data?.note as string) || '',
              link: (data?.link as string) || ''
            },
          };

          if (isColdStart) {
            router.replace(navigationParams);
          } else {
            router.push(navigationParams);
          }

          pendingNavTimeoutRef.current = null;
        }, navDelay);

      }
    }
  }, [router]);

  // Check if app was opened from a notification (cold start or background)
  // IMPORTANT: Only process useLastNotificationResponse once per unique response
  // This hook persists the last response, so we need to prevent re-processing on re-renders
  useEffect(() => {
    logger.info(makeLogHeader(LOG_FILE), '=== useEffect: lastNotificationResponse changed ===');
    logger.info(makeLogHeader(LOG_FILE), 'lastNotificationResponse:', lastNotificationResponse);
    logger.info(makeLogHeader(LOG_FILE), 'Current app state:', AppState.currentState);
    logger.info(makeLogHeader(LOG_FILE), 'App initialized?', { loaded, i18nLoaded, hasI18nPack: !!i18nPack });

    // CRITICAL: Wait for app to be fully initialized before processing notification navigation
    // On cold start, the app needs fonts, i18n, and router to be ready before navigation can succeed
    if (!loaded || !i18nLoaded || !i18nPack) {
      logger.info(makeLogHeader(LOG_FILE), 'App not fully initialized yet, deferring notification navigation processing');
      return;
    }

    // Detect cold start: responseListener not set up yet
    const isColdStart = !responseListener.current;

    // If lastNotificationResponse is null and this is a cold start, mark that we're awaiting it
    // The effect will re-run when lastNotificationResponse becomes available (it's in the dependency array)
    if (!lastNotificationResponse && isColdStart) {
      if (!awaitingInitialResponseRef.current) {
        logger.info(makeLogHeader(LOG_FILE), 'Cold start detected but lastNotificationResponse is null, marking as awaiting initial response');
        awaitingInitialResponseRef.current = true;
      }
      // Effect will re-run when lastNotificationResponse changes from null to a value
      return;
    }

    if (lastNotificationResponse) {
      // Clear awaiting flag since we have the response
      if (awaitingInitialResponseRef.current) {
        logger.info(makeLogHeader(LOG_FILE), 'lastNotificationResponse now available, processing');
        awaitingInitialResponseRef.current = false;
      }
      const { notification, actionIdentifier } = lastNotificationResponse;
      const notificationId = notification.request.identifier;
      const data = notification.request.content.data;
      const parentId = (data?.notificationId as string) || null;
      const dedupeKey = parentId || notificationId;

      // Create a unique response key to prevent React rerenders from retriggering
      // Use notification.date for stable key - this should be consistent across re-renders
      // If notification.date is not available, use a combination that's stable per notification instance
      const trigger = notification.request.trigger;
      const triggerDate = trigger && 'date' in trigger ? trigger.date : undefined;
      const dateValue = notification.date || triggerDate || 0;
      const responseKey = `${notificationId}-${actionIdentifier}-${dateValue}`;

      logger.info(makeLogHeader(LOG_FILE), '=== LAST NOTIFICATION RESPONSE DETECTED ===');
      logger.info(makeLogHeader(LOG_FILE), 'Notification ID:', notificationId);
      logger.info(makeLogHeader(LOG_FILE), 'Parent ID:', parentId);
      logger.info(makeLogHeader(LOG_FILE), 'Dedupe key:', dedupeKey);
      logger.info(makeLogHeader(LOG_FILE), 'Response key:', responseKey);
      logger.info(makeLogHeader(LOG_FILE), 'Action identifier:', actionIdentifier);
      logger.info(makeLogHeader(LOG_FILE), 'Notification data:', notification.request.content.data);
      logger.info(makeLogHeader(LOG_FILE), 'Already handled (dedupe)?', handledNotificationsRef.current.has(dedupeKey));
      logger.info(makeLogHeader(LOG_FILE), 'Already processed (response key)?', lastProcessedResponseKeyRef.current === responseKey);

      // CRITICAL: Check both response key AND dedupe key to prevent any reprocessing
      // The response key prevents the same response object from being processed twice
      // The dedupe key prevents different instances of the same parent notification from triggering navigation
      const alreadyProcessed = lastProcessedResponseKeyRef.current === responseKey;
      const alreadyHandled = handledNotificationsRef.current.has(dedupeKey);

      if (alreadyProcessed || alreadyHandled) {
        logger.info(makeLogHeader(LOG_FILE), `LastNotificationResponse skipped - alreadyProcessed: ${alreadyProcessed}, alreadyHandled: ${alreadyHandled}`);
        return;
      }

      // Mark as processed to prevent re-processing of the same response object
      // But DON'T mark as handled yet - that will be done in handleNotificationNavigation
      // just before navigation to ensure we don't mark it handled too early (e.g., before dev menu is dismissed)
      lastProcessedResponseKeyRef.current = responseKey;

      logger.info(makeLogHeader(LOG_FILE), 'Processing lastNotificationResponse - calling handleNotificationNavigation');

      // On cold start, wait for all interactions to complete (including dev menu dismissal)
      // and use router.replace() to override the default (tabs) route
      // Check if this is a cold start by seeing if responseListener hasn't been set up yet
      const isColdStart = !responseListener.current;

      if (isColdStart) {
        logger.info(makeLogHeader(LOG_FILE), 'Cold start detected, waiting for interactions to complete (dev menu dismissal)');
        // Wait for all interactions to complete - this includes dismissing the Expo dev menu
        InteractionManager.runAfterInteractions(() => {
          // Add an additional delay after interactions complete to ensure router is ready
          // Increased to 1000ms to give more time for notification response to propagate
          setTimeout(() => {
            handleNotificationNavigation(notification, actionIdentifier, true);
          }, 1000);
        });
      } else {
        handleNotificationNavigation(notification, actionIdentifier, false);
      }
    }
  }, [lastNotificationResponse, handleNotificationNavigation, loaded, i18nLoaded, i18nPack]);

  useEffect(() => {
    logger.info(makeLogHeader(LOG_FILE), 'Setting up notification response listener...');
    // Handle notification taps (when app is running or in background)
    // This listener should fire when app is in foreground
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      logger.info(makeLogHeader(LOG_FILE), '=== NOTIFICATION RESPONSE RECEIVED (listener) ===');
      logger.info(makeLogHeader(LOG_FILE), 'Response:', JSON.stringify(response, null, 2));
      const { notification, actionIdentifier } = response;
      const notificationId = notification.request.identifier;
      const data = notification.request.content.data;
      const parentId = (data?.notificationId as string) || null;
      const dedupeKey = parentId || notificationId;

      logger.info(makeLogHeader(LOG_FILE), 'Notification ID:', notificationId);
      logger.info(makeLogHeader(LOG_FILE), 'Parent ID:', parentId);
      logger.info(makeLogHeader(LOG_FILE), 'Dedupe key:', dedupeKey);
      logger.info(makeLogHeader(LOG_FILE), 'Action identifier:', actionIdentifier);
      logger.info(makeLogHeader(LOG_FILE), 'App state:', AppState.currentState);
      logger.info(makeLogHeader(LOG_FILE), 'Notification data:', notification.request.content.data);

      // Only process if we haven't already handled this notification (by dedupe key)
      if (!handledNotificationsRef.current.has(dedupeKey)) {
        // Check if this is the first response after cold start (fallback case)
        // If we were awaiting initial response, treat this as cold start navigation
        const isColdStartFallback = awaitingInitialResponseRef.current;

        if (isColdStartFallback) {
          logger.info(makeLogHeader(LOG_FILE), 'Processing notification from listener - COLD START FALLBACK, using router.replace()');
          awaitingInitialResponseRef.current = false;
          // Clear any retry polling
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current as NodeJS.Timeout);
            retryTimeoutRef.current = null;
          }
          // Use cold start navigation path
          handleNotificationNavigation(notification, actionIdentifier, true);
        } else {
          logger.info(makeLogHeader(LOG_FILE), 'Processing notification from listener - calling handleNotificationNavigation');
          // Listener is set up, so this is not a cold start
          handleNotificationNavigation(notification, actionIdentifier, false);
        }
      } else {
        logger.info(makeLogHeader(LOG_FILE), 'Notification already handled (dedupe key), skipping');
      }
    });
    logger.info(makeLogHeader(LOG_FILE), 'Notification response listener set up, listener ref:', responseListener.current);

    return () => {
      logger.info(makeLogHeader(LOG_FILE), 'Cleaning up notification response listener');
      if (responseListener.current) {
        responseListener.current.remove();
        responseListener.current = null;
      }
      // Clear any pending navigation timeout on cleanup
      if (pendingNavTimeoutRef.current) {
        clearTimeout(pendingNavTimeoutRef.current as NodeJS.Timeout);
        pendingNavTimeoutRef.current = null;
      }
      // Clear any retry polling on cleanup
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current as NodeJS.Timeout);
        retryTimeoutRef.current = null;
      }
      awaitingInitialResponseRef.current = false;
    };
  }, [handleNotificationNavigation]);


  // Calendar change check function
  const performCalendarCheck = useCallback(async () => {
    // Debounce: don't check if we checked within the last 5 seconds
    const now = Date.now();
    if (now - lastCheckTimeRef.current < 5000) {
      return;
    }
    lastCheckTimeRef.current = now;

    try {
      const changes = await checkCalendarEventChanges();
      logger.info(makeLogHeader(LOG_FILE, 'performCalendarCheck'), '[Calendar Check] Received changes:', changes.length);
      if (changes.length > 0) {
        logger.info(makeLogHeader(LOG_FILE, 'performCalendarCheck'), '[Calendar Check] Setting modal state with', changes.length, 'changed events');
        setChangedEvents(changes);
        setShowCalendarChangeModal(true);
      } else {
        logger.info(makeLogHeader(LOG_FILE, 'performCalendarCheck'), '[Calendar Check] No changes found, modal not shown');
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'performCalendarCheck'), 'Failed to check calendar changes:', error);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        // Step 1: Initialize database
        await initDatabase();

        // Step 1.25: Ensure Android notification channel is set up (must happen before scheduling)
        await ensureAndroidNotificationChannel().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE, 'init'), 'Failed to ensure Android notification channel:', error);
        });

        // Step 1.5: Ensure device ID exists and push tokens are up to date
        await getOrCreateDeviceId().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE, 'init'), 'Failed to get or create device ID:', error);
        });
        await ensurePushTokensUpToDate().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE, 'init'), 'Failed to ensure push tokens up to date:', error);
        });

        // Step 2: Get language from database
        const lang = await getAppLanguage();

        // Step 3: Get version from app.json
        const version = appJson.expo.version || '1.0.0';

        // Step 4: Load language pack
        const pack = await initI18n(lang, version);

        // Step 5: Set i18n state
        setI18nLang(lang);
        setI18nVersion(version);
        setI18nPack(pack);
        setI18nLoaded(true);

        logger.info(makeLogHeader(LOG_FILE, 'init'), `i18n initialized: lang=${lang}, version=${version}`);

        // Step 6: Reconcile orphans (detect and remove orphaned notifications/alarms)
        const t = (key: string) => translate(pack, key);
        await reconcileOrphansOnStartup(t).catch((error) => {
          logger.error(makeLogHeader(LOG_FILE, 'init'), 'Failed to reconcile orphans on startup:', error);
        });

        // Don't perform calendar check on app startup - it can cause hangs
        // Calendar check will happen on app focus and screen refresh instead
      } catch (e) {
        logger.error(makeLogHeader(LOG_FILE, 'init'), 'Failed to initialize database/i18n:', e);
        // Set defaults on error to allow app to continue
        const version = appJson.expo.version || '1.0.0';
        const pack = await initI18n('en', version);
        setI18nLang('en');
        setI18nVersion(version);
        setI18nPack(pack);
        setI18nLoaded(true);
      }
    };

    init();
  }, []);

  // Listen for calendar check events from other components
  useEffect(() => {
    const unsubscribe = calendarCheckEvents.subscribe((changedEvents) => {
      if (changedEvents.length > 0) {
        setChangedEvents(changedEvents);
        setShowCalendarChangeModal(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // AppState listener for focus detection
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // iOS AlarmKit: if an alarm stop/dismiss intent stored a pending deep link while the app
        // was backgrounded/covered by the alarm UI, consume it now on resume.
        try {
          const pendingFromAlarmKit = await NativeAlarmManager.getPendingDeepLink?.();
          if (pendingFromAlarmKit) {
            logger.info(makeLogHeader(LOG_FILE, 'deepLink'), 'Consumed pending deep link from AlarmKit on AppState active:', pendingFromAlarmKit);
            await handleDeepLinkNavigation(pendingFromAlarmKit, false);
          }
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE, 'deepLink'), 'Failed to consume pending deep link from AlarmKit on AppState active:', error);
        }

        // First, reconcile permissions (detect transitions and cleanup if needed)
        if (i18nPack) {
          const t = (key: string) => translate(i18nPack, key);
          await reconcilePermissionsOnForeground(t).catch((error) => {
            logger.error(makeLogHeader(LOG_FILE), 'Failed to reconcile permissions:', error);
          });

          // Also reconcile orphans on foreground (lighter variant)
          await reconcileOrphansOnForeground(t).catch((error) => {
            logger.error(makeLogHeader(LOG_FILE), 'Failed to reconcile orphans on foreground:', error);
          });
        }

        // Ensure push tokens are up to date (handles permission revoke/restore)
        await ensurePushTokensUpToDate().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to ensure push tokens up to date on foreground:', error);
        });

        // Check current permissions for gating replenishers
        let notificationPermissionGranted = false;
        let alarmPermissionAuthorized = false;

        try {
          const notificationPerms = await Notifications.getPermissionsAsync();
          notificationPermissionGranted = notificationPerms.status === 'granted';
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to check notification permissions:', error);
        }

        try {
          const alarmCapability = await NativeAlarmManager.checkCapability();
          alarmPermissionAuthorized =
            alarmCapability.capability !== 'none' &&
            (!alarmCapability.requiresPermission || alarmCapability.platformDetails?.alarmKitAuthStatus === 'authorized');
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to check alarm capability:', error);
        }

        // App came to foreground, check for calendar changes
        performCalendarCheck();

        // Migrate eligible rolling-window repeats to Expo repeats (before replenishing)
        if (notificationPermissionGranted) {
          migrateRollingWindowRepeatsToExpo().catch((error) => {
            logger.error(makeLogHeader(LOG_FILE), 'Failed to migrate rolling-window repeats:', error);
          });
        }

        // Proactively migrate daily rolling-window alarms to native recurring (iOS and Android)
        // This runs when start date has passed and app is foregrounded
        if (alarmPermissionAuthorized) {
          const { migrateDailyRollingWindowToNative, migrateAndroidDailyAlarmToNative, getAllScheduledNotificationData } = await import('@/utils/database');
          const scheduledNotifications = await getAllScheduledNotificationData();
          const now = new Date();

          // iOS: Migrate daily rolling-window notifications/alarms
          if (Platform.OS === 'ios' && notificationPermissionGranted) {
            const iosDailyRollingWindow = scheduledNotifications.filter(n => {
              return n.repeatOption === 'daily' &&
                n.repeatMethod === 'rollingWindow' &&
                new Date(n.scheduleDateTime) <= now;
            });

            for (const notification of iosDailyRollingWindow) {
              try {
                await migrateDailyRollingWindowToNative(notification.notificationId);
                logger.info(makeLogHeader(LOG_FILE), `[ProactiveMigration] Migrated iOS daily rolling-window: ${notification.notificationId}`);
              } catch (error) {
                logger.error(makeLogHeader(LOG_FILE), `[ProactiveMigration] Failed to migrate iOS daily rolling-window ${notification.notificationId}:`, error);
              }
            }
          }

          // Android: Migrate alarm-only daily alarms from window to native recurring
          if (Platform.OS === 'android') {
            const androidDailyAlarms = scheduledNotifications.filter(n => {
              return n.repeatOption === 'daily' &&
                n.hasAlarm &&
                n.repeatMethod === 'alarm' &&
                new Date(n.scheduleDateTime) <= now;
            });

            for (const notification of androidDailyAlarms) {
              try {
                await migrateAndroidDailyAlarmToNative(notification.notificationId);
                logger.info(makeLogHeader(LOG_FILE), `[ProactiveMigration] Migrated Android daily alarm: ${notification.notificationId}`);
              } catch (error) {
                logger.error(makeLogHeader(LOG_FILE), `[ProactiveMigration] Failed to migrate Android daily alarm ${notification.notificationId}:`, error);
              }
            }
          }
        }

        // Catch up repeat occurrences (for notifications that fired while app was inactive)
        if (notificationPermissionGranted) {
          const { catchUpRepeatOccurrences } = await import('@/utils/database');
          catchUpRepeatOccurrences().catch((error) => {
            logger.error(makeLogHeader(LOG_FILE), 'Failed to catch up repeat occurrences:', error);
          });
        }

        // Replenish daily alarm windows (ensure 7 future alarms per daily notification)
        // Only if both notification and alarm permissions are granted
        if (notificationPermissionGranted && alarmPermissionAuthorized) {
          ensureDailyAlarmWindowForAllNotifications().catch((error) => {
            logger.error(makeLogHeader(LOG_FILE), 'Failed to replenish daily alarm windows:', error);
          });
        }

        // Replenish rolling-window notification instances (ensure required window size per rolling-window notification)
        // Only if notification permission is granted
        if (notificationPermissionGranted) {
          ensureRollingWindowNotificationInstances().catch((error) => {
            logger.error(makeLogHeader(LOG_FILE), 'Failed to replenish rolling-window notification instances:', error);
          });
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [performCalendarCheck, i18nPack]);


  useEffect(() => {
    // Only handle pending deep links once the app is *fully* initialized.
    // Otherwise we can defer inside handleDeepLinkNavigation() and never re-run this effect.
    if (loaded && i18nLoaded && i18nPack) {
      SplashScreen.hideAsync();

      // If we received a deep link before app initialization completed, handle it now.
      const pending = pendingDeepLinkUrlRef.current;
      if (pending) {
        pendingDeepLinkUrlRef.current = null;
        handleDeepLinkNavigation(pending, true);
      }

      // iOS AlarmKit: consume a pending deep link saved by the stop/dismiss LiveActivityIntent.
      (async () => {
        try {
          const pendingFromAlarmKit = await NativeAlarmManager.getPendingDeepLink?.();
          if (pendingFromAlarmKit) {
            logger.info(makeLogHeader(LOG_FILE, 'deepLink'), 'Consumed pending deep link from AlarmKit:', pendingFromAlarmKit);
            handleDeepLinkNavigation(pendingFromAlarmKit, true);
          }
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE, 'deepLink'), 'Failed to consume pending deep link from AlarmKit:', error);
        }
      })();
    }
  }, [loaded, i18nLoaded, i18nPack, handleDeepLinkNavigation]);

  if (!loaded || !i18nLoaded || !i18nPack) {
    return null;
  }

  return (
    <I18nProvider lang={i18nLang} version={i18nVersion} pack={i18nPack}>
      <KeyboardProvider>
        <AppearanceProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="schedule/[formId]"
                options={{
                  headerShown: false,
                  presentation: 'card',
                }}
              />
              <Stack.Screen
                name="notification-display"
                options={{
                  presentation: 'modal',
                  title: 'Notification', // This is a screen title, not user-facing text that needs i18n
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="debug/os-scheduled-notifications"
                options={{
                  headerShown: false,
                  presentation: 'card',
                }}
              />
              <Stack.Screen
                name="debug/native-alarms"
                options={{
                  headerShown: false,
                  presentation: 'card',
                }}
              />
            </Stack>
            <StatusBar style="auto" />
            <ToastManager />
            <CalendarChangeModal
              visible={showCalendarChangeModal}
              changedEvents={changedEvents}
              onClose={() => setShowCalendarChangeModal(false)}
            />
          </ThemeProvider>
        </AppearanceProvider>
      </KeyboardProvider>
    </I18nProvider>
  );
}
