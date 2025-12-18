import { CalendarChangeModal } from '@/components/calendar-change-modal';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ChangedCalendarEvent, checkCalendarEventChanges } from '@/utils/calendar-check';
import { calendarCheckEvents } from '@/utils/calendar-check-events';
import { archiveScheduledNotifications, ensureDailyAlarmWindowForAllNotifications, ensureRollingWindowNotificationInstances, getScheduledNotificationData, initDatabase, insertRepeatOccurrence, migrateRollingWindowRepeatsToExpo, updateArchivedNotificationData } from '@/utils/database';
import { logger, makeLogHeader } from '@/utils/logger';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { EventSubscription } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { KeyboardProvider } from "react-native-keyboard-controller";
import 'react-native-reanimated';
import ToastManager from 'toastify-react-native';

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
  const [changedEvents, setChangedEvents] = useState<ChangedCalendarEvent[]>([]);
  const [showCalendarChangeModal, setShowCalendarChangeModal] = useState(false);
  const lastCheckTimeRef = useRef<number>(0);
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
  const handleNotificationNavigation = useCallback(async (notification: Notifications.Notification, actionIdentifier: string) => {
    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Notification received:', notification);
    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Action identifier:', actionIdentifier);

    const notificationId = notification.request.identifier;

    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Notification ID:', notificationId);
    logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: App state:', AppState.currentState);

    // Skip if we've already handled this notification
    if (handledNotificationsRef.current.has(notificationId)) {
      logger.info(makeLogHeader(LOG_FILE, 'handleNotificationNavigation'), 'handleNotificationNavigation: Notification already handled, skipping...');
      return;
    }

    // Mark as handled immediately to prevent duplicate processing
    handledNotificationsRef.current.add(notificationId);

    // Only navigate if user tapped the notification (not dismissed it)
    if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {

      // Check if we need to archive any scheduled notifications
      await archiveScheduledNotifications();

      const data = notification.request.content.data;
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

        // Small delay to ensure navigation is ready
        setTimeout(() => {
          router.push({
            pathname: '/notification-display',
            params: { title: data.title as string, message: data.message as string, note: data.note as string, link: data.link as string },
          });
        }, 100);

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
  useEffect(() => {
    logger.info(makeLogHeader(LOG_FILE), '=== useEffect: lastNotificationResponse changed ===');
    logger.info(makeLogHeader(LOG_FILE), 'lastNotificationResponse:', lastNotificationResponse);
    logger.info(makeLogHeader(LOG_FILE), 'Current app state:', AppState.currentState);

    if (lastNotificationResponse) {
      const { notification, actionIdentifier } = lastNotificationResponse;
      const notificationId = notification.request.identifier;
      logger.info(makeLogHeader(LOG_FILE), '=== LAST NOTIFICATION RESPONSE DETECTED ===');
      logger.info(makeLogHeader(LOG_FILE), 'Notification ID:', notificationId);
      logger.info(makeLogHeader(LOG_FILE), 'Action identifier:', actionIdentifier);
      logger.info(makeLogHeader(LOG_FILE), 'Notification data:', notification.request.content.data);
      logger.info(makeLogHeader(LOG_FILE), 'Already handled?', handledNotificationsRef.current.has(notificationId));

      // Only process if we haven't already handled this notification
      if (!handledNotificationsRef.current.has(notificationId)) {
        logger.info(makeLogHeader(LOG_FILE), 'Processing lastNotificationResponse - calling handleNotificationNavigation');
        handleNotificationNavigation(notification, actionIdentifier);
      } else {
        logger.info(makeLogHeader(LOG_FILE), 'LastNotificationResponse already handled, skipping');
      }

    }
  }, [lastNotificationResponse, handleNotificationNavigation]);

  useEffect(() => {
    logger.info(makeLogHeader(LOG_FILE), 'Setting up notification response listener...');
    // Handle notification taps (when app is running or in background)
    // This listener should fire when app is in foreground
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      logger.info(makeLogHeader(LOG_FILE), '=== NOTIFICATION RESPONSE RECEIVED (listener) ===');
      logger.info(makeLogHeader(LOG_FILE), 'Response:', JSON.stringify(response, null, 2));
      const { notification, actionIdentifier } = response;
      const notificationId = notification.request.identifier;
      logger.info(makeLogHeader(LOG_FILE), 'Notification ID:', notificationId);
      logger.info(makeLogHeader(LOG_FILE), 'Action identifier:', actionIdentifier);
      logger.info(makeLogHeader(LOG_FILE), 'App state:', AppState.currentState);
      logger.info(makeLogHeader(LOG_FILE), 'Notification data:', notification.request.content.data);

      // Only process if we haven't already handled this notification
      if (!handledNotificationsRef.current.has(notificationId)) {
        logger.info(makeLogHeader(LOG_FILE), 'Processing notification from listener - calling handleNotificationNavigation');
        handleNotificationNavigation(notification, actionIdentifier);
      } else {
        logger.info(makeLogHeader(LOG_FILE), 'Notification already handled, skipping');
      }
    });
    logger.info(makeLogHeader(LOG_FILE), 'Notification response listener set up, listener ref:', responseListener.current);

    return () => {
      logger.info(makeLogHeader(LOG_FILE), 'Cleaning up notification response listener');
      if (responseListener.current) {
        responseListener.current.remove();
        responseListener.current = null;
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
        await initDatabase();
        // Don't perform calendar check on app startup - it can cause hangs
        // Calendar check will happen on app focus and screen refresh instead
      } catch (e) {
        logger.error(makeLogHeader(LOG_FILE, 'init'), 'Failed to initialize database:', e);
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
        // App came to foreground, check for calendar changes
        performCalendarCheck();

        // Migrate eligible rolling-window repeats to Expo repeats (before replenishing)
        migrateRollingWindowRepeatsToExpo().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to migrate rolling-window repeats:', error);
        });

        // Catch up repeat occurrences (for notifications that fired while app was inactive)
        const { catchUpRepeatOccurrences } = await import('@/utils/database');
        catchUpRepeatOccurrences().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to catch up repeat occurrences:', error);
        });

        // Replenish daily alarm windows (ensure 14 future alarms per daily notification)
        ensureDailyAlarmWindowForAllNotifications().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to replenish daily alarm windows:', error);
        });

        // Replenish rolling-window notification instances (ensure required window size per rolling-window notification)
        ensureRollingWindowNotificationInstances().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to replenish rolling-window notification instances:', error);
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [performCalendarCheck]);


  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <KeyboardProvider>
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
              title: 'Notification',
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
    </KeyboardProvider>
  );
}
