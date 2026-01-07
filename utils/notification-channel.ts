import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { logger, makeLogHeader } from './logger';

const LOG_FILE = 'utils/notification-channel.ts';

// Android notification channel ID - using v2 to force channel recreation
export const ANDROID_NOTIFICATION_CHANNEL_ID = 'thenotifier_v2';

/**
 * Ensures the Android notification channel is created with the correct sound configuration.
 * This should be called on app startup and before scheduling notifications.
 * 
 * Android channels are immutable for sound after creation, so we use a versioned channel ID
 * to force recreation when needed.
 */
export const ensureAndroidNotificationChannel = async (): Promise<void> => {
  if (Platform.OS !== 'android') {
    return; // iOS doesn't use channels
  }

  try {
    await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
      name: 'The Notifier notifications',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'thenotifier.wav',
      vibrationPattern: [0, 1000, 500, 1000],
      enableVibrate: true,
    });
    logger.info(makeLogHeader(LOG_FILE, 'ensureAndroidNotificationChannel'), 'Android notification channel ensured:', ANDROID_NOTIFICATION_CHANNEL_ID);
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'ensureAndroidNotificationChannel'), 'Failed to ensure Android notification channel:', error);
    // Don't throw - allow app to continue even if channel setup fails
  }
};

