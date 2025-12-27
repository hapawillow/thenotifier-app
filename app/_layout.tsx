import { AppearanceProvider } from '@/components/appearance-provider';
import { CalendarChangeModal } from '@/components/calendar-change-modal';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ChangedCalendarEvent, checkCalendarEventChanges } from '@/utils/calendar-check';
import { calendarCheckEvents } from '@/utils/calendar-check-events';
import { archiveScheduledNotifications, ensureDailyAlarmWindowForAllNotifications, ensureRollingWindowNotificationInstances, getAppLanguage, getOrCreateDeviceId, getScheduledNotificationData, initDatabase, insertRepeatOccurrence, migrateRollingWindowRepeatsToExpo, updateArchivedNotificationData } from '@/utils/database';
import { I18nProvider, initI18n } from '@/utils/i18n';
import { logger, makeLogHeader } from '@/utils/logger';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { EventSubscription } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, InteractionManager } from 'react-native';
import { KeyboardProvider } from "react-native-keyboard-controller";
import 'react-native-reanimated';
import ToastManager from 'toastify-react-native';
import appJson from '../app.json';
import { reconcilePermissionsOnForeground } from '@/utils/permission-reconcile';
import { translate } from '@/utils/i18n';
import { ensurePushTokensUpToDate } from '@/utils/push-tokens';
import { NativeAlarmManager } from 'rn-native-alarmkit';
import { reconcileOrphansOnStartup, reconcileOrphansOnForeground } from '@/utils/orphan-reconcile';

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

    // Mark as handled IMMEDIATELY (synchronously) to prevent duplicate processing
    // Do this BEFORE any async operations to prevent race conditions
    handledNotificationsRef.current.add(dedupeKey);
    handledNotificationsRef.current.add(notificationId);

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

      // Check if we need to archive any scheduled notifications
      await archiveScheduledNotifications();

      logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Data:', data);

      // Record repeat occurrence if this is a repeating notification
      try {
        // For rolling-window instances, use parentNotificationId from data
        const parentId = (data?.notificationId as string) || notificationId;
        const scheduledNotification = await getScheduledNotificationData(parentId);

        if (scheduledNotification && scheduledNotification.repeatOption && scheduledNotification.repeatOption !== 'none') {
          // Compute fireDateTime from notification.date or use current time
          const fireDateTime = notification.date ? new Date(notification.date * 1000).toISOString() : new Date().toISOString();

          // Get snapshot from parent notification
          const snapshot = {
            title: scheduledNotification.title,
            message: scheduledNotification.message,
            note: scheduledNotification.note || null,
            link: scheduledNotification.link || null,
          };

          await insertRepeatOccurrence(parentId, fireDateTime, 'tap', snapshot);
          logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `[RepeatOccurrence] Recorded tap occurrence for ${parentId} at ${fireDateTime}`);
        }
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Failed to record repeat occurrence:', error);
      }

      if (data?.message && typeof data.message === 'string') {
        logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Navigating to notification display with message:', data.message);
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
        const navDelay = isColdStart ? 500 : 100;
        const navigationMethod = isColdStart ? 'replace' : 'push';
        
        pendingNavTimeoutRef.current = setTimeout(() => {
          logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), `handleNotificationNavigation: Executing router.${navigationMethod} to notification-display (coldStart: ${isColdStart})`);
          
          const navigationParams = {
            pathname: '/notification-display',
            params: { title: data.title as string, message: data.message as string, note: data.note as string, link: data.link as string },
          };
          
          if (isColdStart) {
            router.replace(navigationParams);
          } else {
            router.push(navigationParams);
          }
          
          pendingNavTimeoutRef.current = null;
        }, navDelay);

        //   // Wait for app to be active and interactions to complete before navigating
        //   const navigateToNotification = () => {
        //     try {
        //       // Use replace to ensure it shows even when coming from background
        //       router.replace({
        //         pathname: '/notification-display',
        //         params: {
        //           message: data.message as string,
        //           link: (data.link as string) || ''
        //         },
        //       });
        //       console.log('handleNotificationNavigation: Navigation triggered with replace');
        //     } catch (error) {
        //       console.error('handleNotificationNavigation: Navigation error:', error);
        //       // Fallback: try push
        //       try {
        //         router.push({
        //           pathname: '/notification-display',
        //           params: {
        //             message: data.message as string,
        //             link: (data.link as string) || ''
        //           },
        //         });
        //         console.log('handleNotificationNavigation: Navigation triggered with push (fallback)');
        //       } catch (pushError) {
        //         console.error('handleNotificationNavigation: Push navigation also failed:', pushError);
        //       }
        //     }
        //   };

        //   // Wait for interactions to complete and navigate
        //   InteractionManager.runAfterInteractions(() => {
        //     setTimeout(navigateToNotification, 200);
        //   });

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

    if (lastNotificationResponse) {
      const { notification, actionIdentifier } = lastNotificationResponse;
      const notificationId = notification.request.identifier;
      const data = notification.request.content.data;
      const parentId = (data?.notificationId as string) || null;
      const dedupeKey = parentId || notificationId;
      
      // Create a unique response key to prevent React rerenders from retriggering
      // Use notification.date for stable key - this should be consistent across re-renders
      // If notification.date is not available, use a combination that's stable per notification instance
      const dateValue = notification.date || notification.request.trigger?.date || 0;
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

      // Mark as processed AND handled BEFORE calling handleNotificationNavigation to prevent race conditions
      // This ensures that even if handleNotificationNavigation is async, we won't process this again
      lastProcessedResponseKeyRef.current = responseKey;
      handledNotificationsRef.current.add(dedupeKey);
      handledNotificationsRef.current.add(notificationId);
      
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
          setTimeout(() => {
            handleNotificationNavigation(notification, actionIdentifier, true);
          }, 300);
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
        logger.info(makeLogHeader(LOG_FILE), 'Processing notification from listener - calling handleNotificationNavigation');
        // Listener is set up, so this is not a cold start
        handleNotificationNavigation(notification, actionIdentifier, false);
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

        // Catch up repeat occurrences (for notifications that fired while app was inactive)
        if (notificationPermissionGranted) {
          const { catchUpRepeatOccurrences } = await import('@/utils/database');
          catchUpRepeatOccurrences().catch((error) => {
            logger.error(makeLogHeader(LOG_FILE), 'Failed to catch up repeat occurrences:', error);
          });
        }

        // Replenish daily alarm windows (ensure 14 future alarms per daily notification)
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
    if (loaded && i18nLoaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded, i18nLoaded]);

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
