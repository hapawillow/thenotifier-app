import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useT } from '@/utils/i18n';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const t = useT();
  const insets = useSafeAreaInsets();

  // On Android, detect if using button navigation vs gesture navigation
  // Button navigation typically has bottom inset of 16-24px
  // Gesture navigation typically has bottom inset of 0-8px
  // Note: Safe area insets may not update dynamically when navigation mode changes
  // The app may need to be restarted for changes to take effect
  // Using a threshold of 16px to distinguish between button (>=16px) and gesture (<16px)
  const isButtonNavigation = Platform.OS === 'android' && insets.bottom >= 16;

  if (Platform.OS === 'android') {
    console.log('Android navigation detection:', {
      bottomInset: insets.bottom,
      isButtonNavigation,
      threshold: 16,
      allInsets: insets,
    });
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: '#226487',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: colors.background,
          ...(Platform.OS === 'android' && {
            paddingTop: 5,
            paddingBottom: isButtonNavigation ? 0 : 20,
            height: isButtonNavigation ? 113 : 80,
          }),
        },
        ...(Platform.OS === 'android' && {
          tabBarLabelStyle: {
            marginBottom: 10,
          },
        }),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('bottomNavBarLabels.home'),
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol size={28} weight={focused ? 'bold' : 'light'} name="house.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: t('bottomNavBarLabels.schedule'),
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol size={28} weight={focused ? 'bold' : 'light'} name="plus" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('bottomNavBarLabels.calendar'),
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol size={28} weight={focused ? 'bold' : 'light'} name="calendar" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          href: null, // Hide from tab bar but keep navigable
        }}
      />
    </Tabs>
  );
}
