import { Platform } from 'react-native';

/**
 * Get the rolling-window size for daily repeats based on platform
 * iOS: 5 days
 * Android: 3 days
 */
export const getDailyRollingWindowSize = (): number => {
  if (Platform.OS === 'ios') {
    const size = process.env.EXPO_PUBLIC_ROLLING_WINDOW_DAILY_IOS;
    return size ? parseInt(size, 10) : 5; // Default to 5 if not set
  } else {
    const size = process.env.EXPO_PUBLIC_ROLLING_WINDOW_DAILY_ANDROID;
    return size ? parseInt(size, 10) : 3; // Default to 3 if not set
  }
};

/**
 * Get the rolling-window size for weekly repeats based on platform
 * iOS: 3 weeks
 * Android: 2 weeks
 */
export const getWeeklyRollingWindowSize = (): number => {
  if (Platform.OS === 'ios') {
    const size = process.env.EXPO_PUBLIC_ROLLING_WINDOW_WEEKLY_IOS;
    return size ? parseInt(size, 10) : 3; // Default to 3 if not set
  } else {
    const size = process.env.EXPO_PUBLIC_ROLLING_WINDOW_WEEKLY_ANDROID;
    return size ? parseInt(size, 10) : 2; // Default to 2 if not set
  }
};

/**
 * Get the rolling-window size for a repeat option
 * Monthly and yearly have no rolling-window (return 0)
 */
export const getRollingWindowSize = (repeatOption: 'daily' | 'weekly' | 'monthly' | 'yearly'): number => {
  switch (repeatOption) {
    case 'daily':
      return getDailyRollingWindowSize();
    case 'weekly':
      return getWeeklyRollingWindowSize();
    case 'monthly':
    case 'yearly':
      return 0; // No rolling-window for monthly/yearly
    default:
      return getDailyRollingWindowSize();
  }
};
