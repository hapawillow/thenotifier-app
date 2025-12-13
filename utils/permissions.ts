import { Platform } from 'react-native';

export type PermissionType = 'alarm' | 'notification' | 'calendar';

export const getPermissionInstructions = (permissionType: PermissionType): string => {
  if (Platform.OS === 'ios') {
    switch (permissionType) {
      case 'alarm':
        return 'To enable alarm permissions:\n\n1. Open Settings\n2. Scroll down and tap "The Notifier"\n3. Tap "Alarms"\n4. Toggle the switch to enable';
      case 'notification':
        return 'To enable notification permissions:\n\n1. Open Settings\n2. Scroll down and tap "The Notifier"\n3. Tap "Notifications"\n4. Toggle "Allow Notifications" to enable';
      case 'calendar':
        return 'To enable calendar permissions:\n\n1. Open Settings\n2. Scroll down and tap "The Notifier"\n3. Tap "Calendar"\n4. Select "Allow Changes to All Events" or "Allow Changes to Events"';
      default:
        return '';
    }
  } else {
    // Android
    switch (permissionType) {
      case 'alarm':
        return 'To enable alarm permissions:\n\n1. Open Settings\n2. Tap "Apps" or "Applications"\n3. Find and tap "The Notifier"\n4. Tap "Permissions"\n5. Find "Alarms" and toggle it on';
      case 'notification':
        return 'To enable notification permissions:\n\n1. Open Settings\n2. Tap "Apps" or "Applications"\n3. Find and tap "The Notifier"\n4. Tap "Notifications"\n5. Toggle "Allow notifications" to enable';
      case 'calendar':
        return 'To enable calendar permissions:\n\n1. Open Settings\n2. Tap "Apps" or "Applications"\n3. Find and tap "The Notifier"\n4. Tap "Permissions"\n5. Find "Calendar" and toggle it on';
      default:
        return '';
    }
  }
};

