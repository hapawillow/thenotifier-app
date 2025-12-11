import { useColorScheme } from '@/hooks/use-color-scheme';
import { archiveScheduledNotifications, initDatabase, updateArchivedNotificationData } from '@/utils/database';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { EventSubscription } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { KeyboardProvider } from "react-native-keyboard-controller";
import 'react-native-reanimated';


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
    console.log('handleNotificationNavigation: Notification received:', notification);
    console.log('handleNotificationNavigation: Action identifier:', actionIdentifier);

    const notificationId = notification.request.identifier;

    console.log('handleNotificationNavigation: Notification ID:', notificationId);
    console.log('handleNotificationNavigation: App state:', AppState.currentState);

    // Skip if we've already handled this notification
    if (handledNotificationsRef.current.has(notificationId)) {
      console.log('handleNotificationNavigation: Notification already handled, skipping...');
      return;
    }

    // Mark as handled immediately to prevent duplicate processing
    handledNotificationsRef.current.add(notificationId);

    // Only navigate if user tapped the notification (not dismissed it)
    if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {

      // Check if we need to archive any scheduled notifications
      await archiveScheduledNotifications();

      const data = notification.request.content.data;
      console.log('handleNotificationNavigation: Data:', data);
      if (data?.message && typeof data.message === 'string') {
        console.log('handleNotificationNavigation: Navigating to notification display with message:', data.message);
        try {
          await updateArchivedNotificationData(notificationId);
          console.log('handleNotificationNavigation: Archived notification data updated successfully');
        } catch (e) {
          console.error('handleNotificationNavigation: Failed to update archived notification data:', e);
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
    console.log('=== useEffect: lastNotificationResponse changed ===');
    console.log('lastNotificationResponse:', lastNotificationResponse);
    console.log('Current app state:', AppState.currentState);

    if (lastNotificationResponse) {
      const { notification, actionIdentifier } = lastNotificationResponse;
      const notificationId = notification.request.identifier;
      console.log('=== LAST NOTIFICATION RESPONSE DETECTED ===');
      console.log('Notification ID:', notificationId);
      console.log('Action identifier:', actionIdentifier);
      console.log('Notification data:', notification.request.content.data);
      console.log('Already handled?', handledNotificationsRef.current.has(notificationId));

      // Only process if we haven't already handled this notification
      if (!handledNotificationsRef.current.has(notificationId)) {
        console.log('Processing lastNotificationResponse - calling handleNotificationNavigation');
        handleNotificationNavigation(notification, actionIdentifier);
      } else {
        console.log('LastNotificationResponse already handled, skipping');
      }

    }
  }, [lastNotificationResponse, handleNotificationNavigation]);

  useEffect(() => {
    console.log('Setting up notification response listener...');
    // Handle notification taps (when app is running or in background)
    // This listener should fire when app is in foreground
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('=== NOTIFICATION RESPONSE RECEIVED (listener) ===');
      console.log('Response:', JSON.stringify(response, null, 2));
      const { notification, actionIdentifier } = response;
      const notificationId = notification.request.identifier;
      console.log('Notification ID:', notificationId);
      console.log('Action identifier:', actionIdentifier);
      console.log('App state:', AppState.currentState);
      console.log('Notification data:', notification.request.content.data);

      // Only process if we haven't already handled this notification
      if (!handledNotificationsRef.current.has(notificationId)) {
        console.log('Processing notification from listener - calling handleNotificationNavigation');
        handleNotificationNavigation(notification, actionIdentifier);
      } else {
        console.log('Notification already handled, skipping');
      }
    });
    console.log('Notification response listener set up, listener ref:', responseListener.current);

    return () => {
      console.log('Cleaning up notification response listener');
      if (responseListener.current) {
        responseListener.current.remove();
        responseListener.current = null;
      }
    };
  }, [handleNotificationNavigation]);


  useEffect(() => {
    const init = async () => {
      try {
        await initDatabase();
      } catch (e) {
        console.error('Failed to initialize database:', e);
      }
    };

    init();
  }, []);


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
            name="schedule"
            options={{
              headerShown: false,
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
      </ThemeProvider>
    </KeyboardProvider>
  );
}
