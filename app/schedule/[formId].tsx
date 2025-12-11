import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { ScheduleForm, ScheduleFormParams } from '@/components/scheduleForm';

export default function ScheduleFormScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const allParams = useLocalSearchParams();

  // Hide header for this screen
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Extract formId from params (it's the dynamic route segment)
  const { formId, ...restParams } = allParams;

  // Type assert params to our expected type
  const params = restParams as ScheduleFormParams & { editMode?: string };

  // Determine edit mode: if no params exist, it's false (tab bar). If editMode='true', it's true (Home). Otherwise false (Calendar).
  const isEditMode = params.editMode === 'true';

  // Convert params to ScheduleFormParams format
  const formParams: ScheduleFormParams | undefined = Object.keys(params).length > 0 ? {
    date: params.date,
    title: params.title,
    message: params.message,
    note: params.note,
    link: params.link,
    repeat: params.repeat as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | undefined,
    notificationId: params.notificationId,
    hasAlarm: params.hasAlarm,
    calendarId: params.calendarId,
    originalEventId: params.originalEventId,
  } : undefined;

  // Determine source: home if editMode, calendar if params exist but not editMode, tab otherwise
  const source: 'home' | 'calendar' | 'tab' = isEditMode ? 'home' : (formParams ? 'calendar' : 'tab');

  const handleSuccess = useCallback(() => {
    // Always navigate to Home screen (Upcoming tab) after success
    // Small delay to ensure alert is dismissed before navigation
    setTimeout(() => {
      router.replace('/(tabs)' as any);
    }, 100);
  }, [router]);

  const handleCancel = useCallback(() => {
    if (isEditMode) {
      // Home source - navigate to Home screen
      // Small delay to ensure alert is dismissed before navigation
      setTimeout(() => {
        router.replace('/(tabs)' as any);
      }, 100);
    } else if (source === 'calendar') {
      // Calendar source - navigate back to Calendar
      router.back();
    }
    // Tab source - do nothing (handled by form component)
  }, [isEditMode, source, router]);

  // Reset form when params change
  useFocusEffect(
    useCallback(() => {
      // Params are already read via useLocalSearchParams, component will handle updates
    }, [params])
  );

  return (
    <ScheduleForm
      initialParams={formParams}
      isEditMode={isEditMode}
      source={source}
      onSuccess={handleSuccess}
      onCancel={handleCancel}
    />
  );
}

