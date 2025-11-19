import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { EventSubscription } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const responseListener = useRef<EventSubscription | null>(null);
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  const handledNotificationsRef = useRef<Set<string>>(new Set());

  // Helper function to handle notification navigation
  const handleNotificationNavigation = useCallback((notification: Notifications.Notification, actionIdentifier: string) => {
    const notificationId = notification.request.identifier;
    console.log('handleNotificationNavigation: Notification received:', notification);
    console.log('handleNotificationNavigation: Action identifier:', actionIdentifier);
    console.log('handleNotificationNavigation: Notification ID:', notificationId);

    // Skip if we've already handled this notification
    if (handledNotificationsRef.current.has(notificationId)) {
      console.log('handleNotificationNavigation: Notification already handled, skipping...');
      return;
    }

    // Only navigate if user tapped the notification (not dismissed it)
    if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      const data = notification.request.content.data;
      if (data?.message && typeof data.message === 'string') {
        handledNotificationsRef.current.add(notificationId);
        console.log('handleNotificationNavigation: Navigating to notification display with message:', data.longMessage);
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
      handleNotificationNavigation(notification, actionIdentifier);
    }
  }, [lastNotificationResponse, handleNotificationNavigation]);

  useEffect(() => {
    // Handle notification taps (when app is running)
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const { notification, actionIdentifier } = response;
      handleNotificationNavigation(notification, actionIdentifier);
    });

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [handleNotificationNavigation]);

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
