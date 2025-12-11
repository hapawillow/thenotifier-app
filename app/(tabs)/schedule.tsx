import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ScheduleForm } from '../components/scheduleForm';

export default function ScheduleTabScreen() {
  const router = useRouter();

  // Reset form when screen is focused (clear any stale params)
  useFocusEffect(
    useCallback(() => {
      // Clear any stale params when opening from tab bar
      router.setParams({});
    }, [router])
  );

  const handleSuccess = useCallback(() => {
    // Form handles its own success message
  }, []);

  const handleCancel = useCallback(() => {
    // Form handles its own cancel logic
  }, []);

  return (
    <ScheduleForm
      isEditMode={false}
      onSuccess={handleSuccess}
      onCancel={handleCancel}
    />
  );
}
