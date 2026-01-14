import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ScheduleForm } from '@/components/scheduleForm';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useT } from '@/utils/i18n';
import { Toast } from 'toastify-react-native';


export default function ScheduleTabScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const t = useT();


  // Reset form when screen is focused (clear any stale params)
  useFocusEffect(
    useCallback(() => {
      // Clear any stale params when opening from tab bar
      router.setParams({});
    }, [router])
  );

  const handleSuccess = useCallback((isAlarm?: boolean) => {
    // Form handles its own success message
    Toast.show({
      type: 'success',
      text1: isAlarm ? t('toastMessages.alarmScheduled') : t('toastMessages.notificationScheduled'),
      position: 'center',
      visibilityTime: 3000,
      autoHide: true,
      backgroundColor: colors.toastBackground,
      textColor: colors.toastTextColor,
      progressBarColor: colors.toastProgressBar,
      iconColor: colors.toastIconColor,
      iconSize: 24,
    });

    setTimeout(() => {
      router.replace('/(tabs)' as any);
    }, 100);

  }, [router, t, colors]);

  const handleCancel = useCallback(() => {
    // Form handles its own cancel logic
  }, []);

  return (
    <ScheduleForm
      isEditMode={false}
      source="schedule"
      onSuccess={handleSuccess}
      onCancel={handleCancel}
    />
  );
}
