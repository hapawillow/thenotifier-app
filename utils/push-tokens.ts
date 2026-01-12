import * as Notifications from 'expo-notifications';
import { clearPushTokens, getOrCreateDeviceId, getPushTokens, upsertPushTokens } from './database';
import { logger, makeLogHeader } from './logger';

const LOG_FILE = 'utils/push-tokens.ts';

/**
 * Ensure push tokens are up to date in the database.
 * - Calls getOrCreateDeviceId() first to ensure deviceId exists
 * - Checks notification permission
 * - If granted: generates/updates Expo and device push tokens
 * - If not granted: clears tokens (but preserves deviceId)
 */
export const ensurePushTokensUpToDate = async (): Promise<void> => {
  try {
    // Ensure deviceId exists first
    const deviceId = await getOrCreateDeviceId();
    logger.info(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), `Device ID: ${deviceId}`);

    // Check notification permission
    const permissions = await Notifications.getPermissionsAsync();
    logger.info(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), `Notification permission status: ${permissions.status}`);

    if (permissions.status !== 'granted') {
      // Permission not granted - clear tokens but preserve deviceId
      await clearPushTokens();
      logger.info(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), 'Notification permission not granted, cleared tokens');
      return;
    }

    // Permission granted - generate/update tokens
    let expoPushToken: string | null = null;
    let devicePushToken: string | null = null;
    let devicePushTokenType: string | null = null;

    try {
      // Get Expo push token
      const expoTokenData = await Notifications.getExpoPushTokenAsync();
      expoPushToken = expoTokenData.data;
      logger.info(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), `Expo push token obtained: ${expoPushToken ? expoPushToken.substring(0, 20) + '...' : 'null'}`);
    } catch (error) {
      // Handle keychain access errors gracefully (e.g., when app launches from background)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isKeychainError = errorMessage.includes('Keychain access failed') || 
                               errorMessage.includes('User interaction is not allowed') ||
                               errorMessage.includes('getRegistrationInfoAsync');
      
      if (isKeychainError) {
        logger.warn(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), 'Keychain access not available (app may have launched from background), skipping Expo push token update');
      } else {
        logger.error(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), 'Failed to get Expo push token:', error);
      }
      // Continue - we'll still try to get device push token
    }

    try {
      // Get device push token (APNS on iOS, FCM on Android)
      const deviceTokenData = await Notifications.getDevicePushTokenAsync();
      devicePushToken = deviceTokenData.data;
      devicePushTokenType = deviceTokenData.type;
      logger.info(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), `Device push token obtained: type=${devicePushTokenType}, token=${devicePushToken ? devicePushToken.substring(0, 20) + '...' : 'null'}`);
    } catch (error) {
      // Handle keychain access errors gracefully (e.g., when app launches from background)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isKeychainError = errorMessage.includes('Keychain access failed') || 
                               errorMessage.includes('User interaction is not allowed') ||
                               errorMessage.includes('getRegistrationInfoAsync');
      
      if (isKeychainError) {
        logger.warn(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), 'Keychain access not available (app may have launched from background), skipping device push token update');
      } else {
        logger.error(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), 'Failed to get device push token:', error);
      }
      // Continue - we'll still save Expo token if we got it
    }

    // Check if tokens have changed
    const existingTokens = await getPushTokens();
    const tokensChanged =
      !existingTokens ||
      existingTokens.expoPushToken !== expoPushToken ||
      existingTokens.devicePushToken !== devicePushToken ||
      existingTokens.devicePushTokenType !== devicePushTokenType;

    if (tokensChanged) {
      // Update tokens in database
      await upsertPushTokens({
        expoPushToken,
        devicePushToken,
        devicePushTokenType,
      });
      logger.info(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), 'Push tokens updated in database');
    } else {
      logger.info(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), 'Push tokens unchanged, no update needed');
    }
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'ensurePushTokensUpToDate'), 'Failed to ensure push tokens up to date:', error);
    // Don't throw - this shouldn't block app startup
  }
};

