import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Keyboard, Platform, StyleSheet, Switch, TextInput, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { NativeAlarmManager } from 'rn-native-alarmkit';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { archiveScheduledNotifications, deleteScheduledNotification, saveScheduledNotificationData } from '@/utils/database';
import * as Crypto from 'expo-crypto';
import { DefaultKeyboardToolbarTheme, KeyboardAwareScrollView, KeyboardToolbar, KeyboardToolbarProps } from 'react-native-keyboard-controller';

// Maximum number of scheduled notifications allowed on the device
const MAX_SCHEDULED_NOTIFICATION_COUNT = (Platform.OS === 'ios' ? 64 : 25);
console.log('Maximum scheduled notification count for', Platform.OS, ':', MAX_SCHEDULED_NOTIFICATION_COUNT);

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const theme: KeyboardToolbarProps["theme"] = {
  dark: {
    ...DefaultKeyboardToolbarTheme.dark,
    primary: "#8ddaff",
    background: "#1d1d1d",
  },
  light: {
    ...DefaultKeyboardToolbarTheme.light,
    primary: "#242424",
    background: "#D0E8FC",
  },
};

export interface ScheduleFormParams {
  date?: string;
  title?: string;
  message?: string;
  note?: string;
  link?: string;
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  notificationId?: string;
  hasAlarm?: string;
  calendarId?: string;
  originalEventId?: string;
}

export interface ScheduleFormProps {
  initialParams?: ScheduleFormParams;
  isEditMode: boolean;
  source?: 'home' | 'calendar' | 'tab';
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ScheduleForm({ initialParams, isEditMode, source = 'tab', onSuccess, onCancel }: ScheduleFormProps) {
  // Initialize state from initialParams if available
  const [title, setTitle] = useState(initialParams?.title || '');
  const [message, setMessage] = useState(initialParams?.message || '');
  const [note, setNote] = useState(initialParams?.note || '');
  const [link, setLink] = useState(initialParams?.link || '');
  const [selectedDate, setSelectedDate] = useState(
    initialParams?.date ? new Date(initialParams.date) : new Date()
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showRepeatPicker, setShowRepeatPicker] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const scrollViewRef = useRef<any>(null);
  const messageInputRef = useRef<TextInput>(null);
  const noteInputRef = useRef<TextInput>(null);
  const linkInputRef = useRef<TextInput>(null);
  const scheduleButtonRef = useRef<any>(null);
  const formTopInContent = useRef<number>(0);
  const buttonBottomInForm = useRef<number>(0);
  const keyboardHeightRef = useRef<number>(0);
  const hasScrolledForFocus = useRef<boolean>(false);
  const [scheduleAlarm, setScheduleAlarm] = useState(false);
  const [alarmSupported, setAlarmSupported] = useState(false);
  const [repeatOption, setRepeatOption] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>(
    (initialParams?.repeat as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly') || 'none'
  );
  const [editingNotificationId, setEditingNotificationId] = useState<string | null>(
    initialParams?.notificationId || null
  );
  const [editingHasAlarm, setEditingHasAlarm] = useState(
    initialParams?.hasAlarm === 'true'
  );

  // Memoize minimum date to prevent creating new Date object on each render
  const minimumDate = useMemo(() => new Date(), []);

  // Update state when initialParams change
  useEffect(() => {
    if (initialParams) {
      if (initialParams.date) {
        setSelectedDate(new Date(initialParams.date));
      }
      if (initialParams.title !== undefined) {
        setTitle(initialParams.title);
      }
      if (initialParams.message !== undefined) {
        setMessage(initialParams.message);
      }
      if (initialParams.note !== undefined) {
        setNote(initialParams.note);
      }
      if (initialParams.link !== undefined) {
        setLink(initialParams.link);
      }
      if (initialParams.repeat) {
        setRepeatOption(initialParams.repeat);
      }
      if (initialParams.notificationId) {
        setEditingNotificationId(initialParams.notificationId);
      }
      if (initialParams.hasAlarm === 'true') {
        setEditingHasAlarm(true);
        setScheduleAlarm(true);
      } else if (initialParams.hasAlarm === 'false') {
        setEditingHasAlarm(false);
        setScheduleAlarm(false);
      }
    }
  }, [initialParams]);

  // Check if scheduled notifications count has reached the maximum
  // Skip check if in edit mode since we're replacing an existing notification
  const checkNotificationLimit = useCallback(async (): Promise<boolean> => {
    // Skip check in edit mode
    if (isEditMode) {
      return false;
    }

    try {
      // Archive past notifications first
      await archiveScheduledNotifications();
      // Get all scheduled notifications
      const { getAllScheduledNotificationData } = await import('@/utils/database');
      const scheduledNotifications = await getAllScheduledNotificationData();
      // Filter for future notifications only
      const now = new Date().toISOString();
      const futureNotifications = scheduledNotifications.filter(
        item => item.scheduleDateTime > now
      );
      const count = futureNotifications.length;

      // Check if we've reached the maximum
      if (count >= MAX_SCHEDULED_NOTIFICATION_COUNT) {
        console.log('Maximum notifications reached:', count);
        Alert.alert(
          'Maximum Notifications Reached',
          `Uh oh, you've reached the maximum of ${MAX_SCHEDULED_NOTIFICATION_COUNT} scheduled notifications. You can delete an upcoming notification if you need to schedule a new notification.`,
          [{ text: 'OK' }]
        );
        return true; // Limit reached
      }
      return false; // Limit not reached
    } catch (error) {
      console.error('Failed to check scheduled notifications count:', error);
      return false;
    }
  }, [isEditMode]);

  useEffect(() => {
    // Request permissions
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please enable notifications in your device settings.');
      }

      // Check if alarm module is available (don't request permission yet - wait for user action)
      try {
        const capability = await NativeAlarmManager.checkCapability();
        console.log('Alarm capability check:', capability);

        if (capability.capability !== 'none') {
          setAlarmSupported(true);
        } else {
          setAlarmSupported(false);
          console.log('Alarms are not supported on this device');
        }
      } catch (error) {
        console.error('Alarm module error:', error);
        setAlarmSupported(false);
      }
    })();
  }, []);

  // Memoize form onLayout handler
  const handleFormLayout = useCallback((event: any) => {
    const { y } = event.nativeEvent.layout;
    formTopInContent.current = y;
  }, []);

  // Memoize button onLayout handler
  const handleButtonLayout = useCallback((event: any) => {
    const { y, height } = event.nativeEvent.layout;
    buttonBottomInForm.current = y + height;
  }, []);

  // Memoize DateTimePicker onChange handler
  const handleDateChange = useCallback((event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'set' && date) {
      setSelectedDate(date);
    }
    if (Platform.OS === 'android' && event.type === 'dismissed') {
      setShowDatePicker(false);
    }
  }, []);

  // Helper function to scroll to show the button above keyboard
  const scrollToShowButton = useCallback((keyboardHeight: number) => {
    if (formTopInContent.current === 0 || buttonBottomInForm.current === 0) {
      setTimeout(() => scrollToShowButton(keyboardHeight), 100);
      return;
    }

    const screenHeight = Dimensions.get('window').height;
    const gap = 10;

    const buttonBottomInContent = formTopInContent.current + buttonBottomInForm.current;
    const visibleHeight = screenHeight - keyboardHeight;

    let targetScrollY = buttonBottomInContent - visibleHeight + gap;
    targetScrollY += 20;

    scrollViewRef.current?.scrollTo({
      y: Math.max(0, targetScrollY),
      animated: true,
    });
  }, []);

  // Memoize inline style objects
  const dateButtonStyle = useMemo(() => [
    styles.dateButton,
    { borderColor: colors.icon, backgroundColor: colors.background }
  ], [colors.icon, colors.background]);

  const doneButtonStyle = useMemo(() => [
    styles.button,
    { backgroundColor: colors.tint, marginTop: 10 }
  ], [colors.tint]);

  const inputStyle = useMemo(() => [
    styles.input,
    { color: colors.text, borderColor: colors.icon }
  ], [colors.text, colors.icon]);

  const textAreaStyle = useMemo(() => [
    styles.input,
    styles.textArea,
    { color: colors.text, borderColor: colors.icon }
  ], [colors.text, colors.icon]);

  const scheduleButtonStyle = useMemo(() => [
    styles.button,
    { backgroundColor: colors.tint }
  ], [colors.tint]);

  const doneButtonTextStyle = useMemo(() => [
    styles.buttonText,
    { color: colors.buttonText }
  ], [colors.buttonText]);

  const scheduleButtonTextStyle = useMemo(() => [
    styles.buttonText,
    { color: colors.buttonText }
  ], [colors.buttonText]);

  const repeatButtonStyle = useMemo(() => [
    styles.dateButton,
    { borderColor: colors.icon, backgroundColor: colors.background }
  ], [colors.icon, colors.background]);

  // Memoize callbacks
  const handleDateButtonPress = useCallback(async () => {
    const limitReached = await checkNotificationLimit();
    if (limitReached) {
      return;
    }
    Keyboard.dismiss();
    setShowDatePicker(true);
  }, [checkNotificationLimit]);

  const handleRepeatButtonPress = useCallback(async () => {
    const limitReached = await checkNotificationLimit();
    if (limitReached) {
      return;
    }
    Keyboard.dismiss();
    setShowRepeatPicker(true);
  }, [checkNotificationLimit]);

  const handleRepeatDonePress = useCallback(() => {
    setShowRepeatPicker(false);
  }, []);

  const handleRepeatChange = useCallback((value: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly') => {
    setRepeatOption(value);
    if (Platform.OS === 'android') {
      setShowRepeatPicker(false);
    }
  }, []);

  const formatRepeatOption = useCallback((option: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly') => {
    switch (option) {
      case 'none':
        return 'Do not repeat';
      case 'daily':
        return 'Repeat every day';
      case 'weekly':
        return 'Repeat every week';
      case 'monthly':
        return 'Repeat every month';
      case 'yearly':
        return 'Repeat every year';
      default:
        return 'Do not repeat';
    }
  }, []);

  const handleDonePress = useCallback(() => {
    setShowDatePicker(false);
  }, []);

  const handleMessageFocus = useCallback(async () => {
    const limitReached = await checkNotificationLimit();
    if (limitReached) {
      messageInputRef.current?.blur();
      return;
    }
  }, [checkNotificationLimit]);

  const handleNoteFocus = useCallback(async () => {
    const limitReached = await checkNotificationLimit();
    if (limitReached) {
      noteInputRef.current?.blur();
      return;
    }
  }, [checkNotificationLimit]);

  const handleLinkFocus = useCallback(async () => {
    const limitReached = await checkNotificationLimit();
    if (limitReached) {
      linkInputRef.current?.blur();
      return;
    }
    hasScrolledForFocus.current = true;

    setTimeout(() => {
      if (keyboardHeightRef.current > 0) {
        scrollToShowButton(keyboardHeightRef.current);
      } else {
        const estimatedKeyboardHeight = Platform.OS === 'ios' ? 336 : 300;
        scrollToShowButton(estimatedKeyboardHeight);
      }
    }, Platform.OS === 'ios' ? 400 : 500);
  }, [checkNotificationLimit, scrollToShowButton]);

  const handleLinkBlur = useCallback(() => {
    if (hasScrolledForFocus.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({
          y: 0,
          animated: true,
        });
        hasScrolledForFocus.current = false;
      }, Platform.OS === 'ios' ? 200 : 300);
    }
  }, []);

  useEffect(() => {
    const keyboardWillShowListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        keyboardHeightRef.current = e.endCoordinates.height;
        if (linkInputRef.current?.isFocused()) {
          setTimeout(() => {
            scrollToShowButton(keyboardHeightRef.current);
          }, Platform.OS === 'ios' ? 350 : 450);
        }
      }
    );

    const keyboardWillHideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        if (hasScrolledForFocus.current && linkInputRef.current?.isFocused() === false) {
          setTimeout(() => {
            scrollViewRef.current?.scrollTo({
              y: 0,
              animated: true,
            });
            hasScrolledForFocus.current = false;
          }, 100);
        }
      }
    );

    return () => {
      keyboardWillShowListener.remove();
      keyboardWillHideListener.remove();
    };
  }, [scrollToShowButton]);

  const resetForm = () => {
    setMessage('');
    setNote('');
    setLink('');
    setTitle('');
    setSelectedDate(new Date());
    setScheduleAlarm(false);
    setRepeatOption('none');
    setShowRepeatPicker(false);
    setEditingNotificationId(null);
    setEditingHasAlarm(false);
  };

  const handleClearOrCancel = useCallback(() => {
    if (source === 'home' || source === 'calendar') {
      resetForm();
      if (source === 'home') {
        Alert.alert(
          'Cancel Edit',
          'The upcoming event will be unchanged.',
          [
            {
              text: 'OK',
              onPress: () => {
                onCancel?.();
              },
            },
          ]
        );
      } else {
        // Calendar source - just navigate back
        onCancel?.();
      }
    } else {
      // Tab source - just reset form
      resetForm();
    }
  }, [source, onCancel]);

  const scheduleNotification = async () => {
    console.log('=== SCHEDULE NOTIFICATION ===');

    if (!message.trim()) {
      Alert.alert('Error', 'You forgot the message');
      return;
    }

    console.log('Selected date:', selectedDate);

    const dateWithoutSeconds = new Date(selectedDate);
    dateWithoutSeconds.setSeconds(0, 0);

    const now = new Date();
    const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

    if (dateWithoutSeconds <= oneMinuteFromNow) {
      Alert.alert('Error', 'Select a future date and time more than 1 minute from now');
      return;
    }

    // If in edit mode, cancel existing notification and alarm, then delete from DB
    if (isEditMode && editingNotificationId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(editingNotificationId);
        console.log('Cancelled existing notification:', editingNotificationId);
        const alarmId = `alarm-${editingNotificationId}`;
        console.log('Cancelling existing alarm with ID:', alarmId);
        if (editingHasAlarm) {
          try {
            const existingAlarm = await NativeAlarmManager.getAlarm(alarmId);
            if (existingAlarm) {
              await NativeAlarmManager.cancelAlarm(alarmId);
              console.log('Cancelled existing alarm:', alarmId);
            } else {
              console.log('Alarm not found, may have already been cancelled:', alarmId);
            }
          } catch (alarmError) {
            const errorMessage = alarmError instanceof Error ? alarmError.message : String(alarmError);
            if (errorMessage.includes('not found') || errorMessage.includes('ALARM_NOT_FOUND')) {
              console.log('Alarm not found (may have already been cancelled):', alarmId);
            } else {
              console.error('Failed to cancel existing alarm:', alarmId, ', error:', alarmError);
            }
          }
        }

        await deleteScheduledNotification(editingNotificationId);
        console.log('Deleted existing notification from DB:', editingNotificationId);
      } catch (error) {
        console.error('Failed to cancel/delete existing notification:', error);
        Alert.alert('Error', 'Failed to update notification. Please try again.');
        return;
      }
    }

    const notificationId = "thenotifier-" + Crypto.randomUUID();
    const notificationTitle = title || 'Personal';

    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('thenotifier', {
          name: 'The Notifier notifications',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'thenotifier.wav',
        });
      }

      const deepLinkUrl = (link) ? `thenotifier://notification?title=${encodeURIComponent(title)}&message=${encodeURIComponent(message)}&note=${encodeURIComponent(note)}&link=${encodeURIComponent(link)}` : `thenotifier://notification?title=${encodeURIComponent(title)}&message=${encodeURIComponent(message)}&note=${encodeURIComponent(note)}`;
      console.log('deepLinkUrl:', deepLinkUrl);

      let notificationContent: Notifications.NotificationContentInput = {
        title: notificationTitle,
        body: message,
        data: {
          title: notificationTitle,
          message: message,
          note: note,
          link: link ? link : '',
          url: deepLinkUrl
        },
        sound: 'thenotifier.wav'
      };
      if (Platform.OS === 'android') {
        notificationContent.vibrate = [0, 1000, 500, 1000];
      }
      if (Platform.OS === 'ios') {
        notificationContent.interruptionLevel = 'timeSensitive';
      }
      console.log('notificationContent:', notificationContent);

      let notificationTrigger: Notifications.NotificationTriggerInput;
      const hour = dateWithoutSeconds.getHours();
      const minute = dateWithoutSeconds.getMinutes();
      const day = dateWithoutSeconds.getDate();
      const dayOfWeek = dateWithoutSeconds.getDay();
      const month = dateWithoutSeconds.getMonth();
      switch (repeatOption) {
        case 'none':
          notificationTrigger = {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: dateWithoutSeconds,
          };
          break;
        case 'daily':
          notificationTrigger = {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: hour,
            minute: minute,
          };
          break;
        case 'weekly':
          notificationTrigger = {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: dayOfWeek,
            hour: hour,
            minute: minute,
          };
          break;
        case 'monthly':
          notificationTrigger = {
            type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
            day: day,
            hour: hour,
            minute: minute,
          };
          break;
        case 'yearly':
          notificationTrigger = {
            type: Notifications.SchedulableTriggerInputTypes.YEARLY,
            month: month,
            day: day,
            hour: hour,
            minute: minute,
          };
          break;
      }

      if (Platform.OS === 'android') {
        (notificationTrigger as any).channelId = "thenotifier";
      }
      console.log('notificationTrigger:', notificationTrigger);

      console.log('=== SCHEDULE NOTIFICATION ASYNC ===');
      await Notifications.scheduleNotificationAsync({
        identifier: notificationId,
        content: notificationContent,
        trigger: notificationTrigger,
      });

      console.log('Notification scheduled successfully, saving notification data...', notificationId, notificationTitle, message, note, link, dateWithoutSeconds.toISOString(), dateWithoutSeconds.toLocaleString(), repeatOption, notificationTrigger, scheduleAlarm && alarmSupported, initialParams?.calendarId, initialParams?.originalEventId);
      await saveScheduledNotificationData(notificationId, notificationTitle, message, note, link ? link : '', dateWithoutSeconds.toISOString(), dateWithoutSeconds.toLocaleString(), repeatOption, notificationTrigger, scheduleAlarm && alarmSupported, initialParams?.calendarId, initialParams?.originalEventId);
      console.log('Notification data saved successfully');

      // Schedule alarm if enabled
      if (scheduleAlarm && alarmSupported) {
        try {
          const capability = await NativeAlarmManager.checkCapability();
          console.log('Alarm capability before scheduling:', capability);

          let authStatus = capability.platformDetails?.alarmKitAuthStatus;
          console.log('AlarmKit auth status:', authStatus);

          if (capability.requiresPermission) {
            if (authStatus === 'notDetermined' && capability.canRequestPermission) {
              try {
                console.log('Requesting alarm permission...');
                const granted = await NativeAlarmManager.requestPermission();
                console.log('Alarm permission granted:', granted);

                if (!granted) {
                  Alert.alert(
                    'Alarm Permission Denied',
                    'Alarm permission was denied. To schedule alarms, please grant permission when prompted. You may need to delete and reinstall the app to be prompted again.',
                    [{ text: 'OK' }]
                  );
                  resetForm();
                  return;
                }

                const postRequestCapability = await NativeAlarmManager.checkCapability();
                const postRequestAuthStatus = postRequestCapability.platformDetails?.alarmKitAuthStatus;
                console.log('Updated auth status after permission request:', postRequestAuthStatus);

                if (postRequestAuthStatus !== 'authorized') {
                  Alert.alert(
                    'Alarm Permission Not Granted',
                    'Alarm permission was not granted. Please try again or delete and reinstall the app to be prompted again.',
                    [{ text: 'OK' }]
                  );
                  resetForm();
                  return;
                }

                authStatus = postRequestAuthStatus;
              } catch (permissionError) {
                console.error('Failed to request alarm permission:', permissionError);
                const errorMsg = permissionError instanceof Error ? permissionError.message : String(permissionError);

                const errorCheckCapability = await NativeAlarmManager.checkCapability();
                const errorCheckAuthStatus = errorCheckCapability.platformDetails?.alarmKitAuthStatus;

                if (errorCheckAuthStatus === 'denied') {
                  Alert.alert(
                    'Alarm Permission Denied',
                    'Alarm permission was denied. To schedule alarms, please delete and reinstall the app to be prompted for permission again.',
                    [{ text: 'OK' }]
                  );
                  resetForm();
                  return;
                } else {
                  Alert.alert(
                    'Alarm Permission Error',
                    `Unable to request alarm permission: ${errorMsg}\n\nThis may be a system issue. Please try again or restart the app.`,
                    [{ text: 'OK' }]
                  );
                  resetForm();
                  return;
                }
              }
            } else if (authStatus === 'denied') {
              Alert.alert(
                'Alarm Permission Denied',
                'Alarm permission was previously denied. To schedule alarms, please delete and reinstall the app to be prompted for permission again.',
                [{ text: 'OK' }]
              );
              resetForm();
              return;
            } else if (authStatus !== 'authorized') {
              Alert.alert(
                'Alarm Permission Required',
                'Alarm permission is required but not granted. Please try scheduling again to be prompted for permission.',
                [{ text: 'OK' }]
              );
              resetForm();
              return;
            }

            if (authStatus !== 'authorized') {
              console.log('Alarm permission not authorized, cannot schedule');
              resetForm();
              return;
            }
          }

          const hour = dateWithoutSeconds.getHours();
          const minutes = dateWithoutSeconds.getMinutes();

          const alarmId = `alarm-${notificationId}`;
          console.log('Scheduling alarm with ID:', alarmId);
          console.log('Alarm date:', dateWithoutSeconds.toISOString());
          await NativeAlarmManager.scheduleAlarm(
            {
              id: alarmId,
              type: 'fixed',
              date: dateWithoutSeconds,
              time: {
                hour: hour,
                minute: minutes,
              },
            },
            {
              title: message,
              color: '#8ddaff',
              data: {
                notificationId: notificationId,
              },
              actions: [
                {
                  id: 'dismiss',
                  title: 'Dismiss',
                  behavior: 'dismiss',
                  icon: Platform.select({
                    ios: 'xmark',
                    android: 'ic_cancel'
                  })
                },
                {
                  id: 'snooze',
                  title: 'Snooze 10m',
                  behavior: 'snooze',
                  snoozeDuration: 5,
                  icon: Platform.select({
                    ios: 'zzz',
                    android: 'ic_snooze'
                  })
                },
              ]
            },
          );

          console.log('Alarm scheduled successfully for:', dateWithoutSeconds);
          setTimeout(async () => {
            const existingAlarm = await NativeAlarmManager.getAlarm(alarmId);
            if (existingAlarm) {
              console.log('Scheduled existing alarm found in NativeAlarmManager:', alarmId);
            } else {
              console.log('Scheduled alarm not found in NativeAlarmManager:', alarmId);
            }
          }, 500);

        } catch (error) {
          console.error('Failed to schedule alarm:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('permission') || errorMessage.includes('Permission') || errorMessage.includes('authorization')) {
            Alert.alert(
              'Alarm Permission Required',
              'You won\'t be able to add an alarm until you give this app permission to set alarms. If you denied the alarm permission dialog, you can allow this app to set alarms in your system settings. If that doesn\'t work then you may need to delete and reinstall the app.',
              [{ text: 'OK' }]
            );
          } else {
            Alert.alert('Warning', `The notification was scheduled, but there was a problem scheduling the alarm: ${errorMessage}`);
          }
        }
      }

      if (isEditMode) {
        Alert.alert(
          'Success',
          'Your existing notification has been changed.',
          [
            {
              text: 'OK',
              onPress: () => {
                onSuccess?.();
              },
            },
          ]
        );
      } else {
        Alert.alert(
          'Success',
          'Your notification has been scheduled!',
          [
            {
              text: 'OK',
              onPress: () => {
                onSuccess?.();
              },
            },
          ]
        );
      }

      console.log('Notification scheduled with ID:', notificationId);
      console.log('Notification selected date:', dateWithoutSeconds);
      console.log('Notification title:', notificationTitle);
      console.log('Notification message:', message);
      console.log('Notification note:', note);
      console.log('Notification link:', link);

      resetForm();
      onSuccess?.();
    } catch (error) {
      if (isEditMode) {
        Alert.alert('Error', 'Sorry, your notification could not be updated.');
      } else {
        Alert.alert('Error', 'Sorry, your notification could not be scheduled.');
      }
      console.error(error);
      console.error('Failed to schedule notification with ID:', notificationId);
      console.error('Failed selected date:', dateWithoutSeconds);
      console.error('Failed title:', notificationTitle);
      console.error('Failed message:', message);
      console.error('Failed note:', note);
      console.error('Failed link:', link);
    }
  };

  const formatDateTime = useCallback((date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, []);

  useEffect(() => {
    (async () => {
      await archiveScheduledNotifications();
    })();
  }, []);

  const clearButtonStyle = useMemo(() => [
    styles.clearButton,
    { borderColor: colors.tint }
  ], [colors.tint]);

  const clearButtonTextStyle = useMemo(() => [
    styles.clearButtonText,
    { color: colors.tint }
  ], [colors.tint]);

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
      </ThemedView>

      <KeyboardAwareScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>

          <ThemedView
            style={styles.form}
            onLayout={handleFormLayout}>

            <ThemedView style={styles.clearButtonContainer}>
              <TouchableOpacity
                style={clearButtonStyle}
                onPress={handleClearOrCancel}
                activeOpacity={0.7}>
                <ThemedText style={clearButtonTextStyle}>{source === 'home' || source === 'calendar' ? 'Cancel' : 'Clear'}</ThemedText>
              </TouchableOpacity>
            </ThemedView>

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle">Date & Time</ThemedText>
              <TouchableOpacity
                style={dateButtonStyle}
                onPress={handleDateButtonPress}>
                <ThemedText>{formatDateTime(selectedDate)}</ThemedText>
              </TouchableOpacity>
            </ThemedView>

            {showDatePicker && (
              <DateTimePicker
                value={selectedDate}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleDateChange}
                minimumDate={minimumDate}
              />
            )}
            {Platform.OS === 'ios' && showDatePicker && (
              <TouchableOpacity
                style={doneButtonStyle}
                onPress={handleDonePress}>
                <ThemedText style={doneButtonTextStyle}>Done</ThemedText>
              </TouchableOpacity>
            )}

            <ThemedView style={styles.inputGroup}>
              <TouchableOpacity
                style={repeatButtonStyle}
                onPress={handleRepeatButtonPress}>
                <ThemedText>{formatRepeatOption(repeatOption)}</ThemedText>
              </TouchableOpacity>
            </ThemedView>

            {showRepeatPicker && (
              <Picker
                selectedValue={repeatOption}
                onValueChange={handleRepeatChange}
                style={[styles.picker, { color: colors.text, borderColor: colors.icon, backgroundColor: colors.background }]}
                itemStyle={{ color: colors.text }}
              >
                <Picker.Item label="Do not repeat" value="none" />
                <Picker.Item label="Repeat every day" value="daily" />
                <Picker.Item label="Repeat every week" value="weekly" />
                <Picker.Item label="Repeat every month" value="monthly" />
                <Picker.Item label="Repeat every year" value="yearly" />
              </Picker>
            )}
            {Platform.OS === 'ios' && showRepeatPicker && (
              <TouchableOpacity
                style={doneButtonStyle}
                onPress={handleRepeatDonePress}>
                <ThemedText style={doneButtonTextStyle}>Done</ThemedText>
              </TouchableOpacity>
            )}

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle">Message</ThemedText>
              <TextInput
                ref={messageInputRef}
                style={inputStyle}
                placeholder="Notification message"
                placeholderTextColor={colors.placeholderText}
                value={message}
                onChangeText={setMessage}
                onFocus={handleMessageFocus}
                multiline
                numberOfLines={2}
              />
            </ThemedView>

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle">Note (optional)</ThemedText>
              <TextInput
                ref={noteInputRef}
                style={textAreaStyle}
                placeholder="A short note"
                placeholderTextColor={colors.placeholderText}
                value={note}
                onChangeText={setNote}
                onFocus={handleNoteFocus}
                multiline
                numberOfLines={6}
              />
            </ThemedView>

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle">Link (optional)</ThemedText>
              <TextInput
                ref={linkInputRef}
                style={inputStyle}
                placeholder="Link to open for this notification"
                placeholderTextColor={colors.placeholderText}
                value={link}
                onChangeText={setLink}
                onFocus={handleLinkFocus}
                onBlur={handleLinkBlur}
              />
            </ThemedView>

            {alarmSupported && (
              <ThemedView style={styles.inputGroup}>
                <ThemedView style={styles.switchContainer}>
                  <ThemedText type="subtitle">Add an Alarm</ThemedText>
                  <Switch
                    value={scheduleAlarm}
                    onValueChange={setScheduleAlarm}
                    trackColor={{ false: '#888', true: '#68CFAF' }}
                    thumbColor={Platform.OS === 'ios' ? '#f0f0f0' : colors.background}
                  />
                </ThemedView>
              </ThemedView>
            )}

            <TouchableOpacity
              ref={scheduleButtonRef}
              style={scheduleButtonStyle}
              onPress={scheduleNotification}
              onLayout={handleButtonLayout}>
              <ThemedText style={scheduleButtonTextStyle}>{isEditMode ? 'Update' : 'Schedule'} Notification</ThemedText>
            </TouchableOpacity>
          </ThemedView>

        </TouchableWithoutFeedback>
      </KeyboardAwareScrollView>
      <KeyboardToolbar opacity="CF" offset={{ opened: 94, closed: 0 }} theme={theme}>
        <KeyboardToolbar.Prev />
        <KeyboardToolbar.Next />
        <KeyboardToolbar.Done />
      </KeyboardToolbar>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
  },
  header: {
    marginTop: 40,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  clearButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: -10,
  },
  clearButton: {
    borderWidth: 1,
    borderRadius: 50,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  form: {
    gap: 20,
  },
  inputGroup: {
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    minHeight: 48,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  dateButton: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 50,
    justifyContent: 'center',
  },
  button: {
    borderRadius: 50,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchDescription: {
    fontSize: 14,
    marginTop: 4,
    fontStyle: 'italic',
  },
  keyboardToolbar: {
    width: '100%',
  },
  picker: {
    padding: 12,
    minHeight: 50,
  },
});

