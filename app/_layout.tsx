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
    const notificationId = notification.request.identifier;
    console.log('handleNotificationNavigation: Notification received:', notification);
    console.log('handleNotificationNavigation: Action identifier:', actionIdentifier);
    console.log('handleNotificationNavigation: Notification ID:', notificationId);

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
          // const result = await getArchivedNotificationData(notificationId);
          // console.log('handleNotificationNavigation: Updated archived notification data:', result);
        } catch (e) {
          console.error('handleNotificationNavigation: Failed to update archived notification data:', e);
        }

        // Small delay to ensure navigation is ready
        setTimeout(() => {
          router.push({
            pathname: '/notification-display',
            params: { message: data.message as string, link: data.link as string },
          });
        }, 100);
      }
    }
  }, [router]);

  // Check if app was opened from a notification (cold start)
  useEffect(() => {
    if (lastNotificationResponse) {
      const { notification, actionIdentifier } = lastNotificationResponse;
      const notificationId = notification.request.identifier;

      // handleNotificationNavigation(notification, actionIdentifier);

      // Only process if we haven't already handled this notification
      if (!handledNotificationsRef.current.has(notificationId)) {
        handleNotificationNavigation(notification, actionIdentifier);
      }

    }
  }, [lastNotificationResponse, handleNotificationNavigation]);

  useEffect(() => {
    // Handle notification taps (when app is running)
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const { notification, actionIdentifier } = response;
      const notificationId = notification.request.identifier;

      // handleNotificationNavigation(notification, actionIdentifier);

      // Only process if we haven't already handled this notification
      if (!handledNotificationsRef.current.has(notificationId)) {
        handleNotificationNavigation(notification, actionIdentifier);
      }

    });

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
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
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
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
  );
}
