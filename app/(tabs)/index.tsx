import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Keyboard, Platform, StyleSheet, Switch, TextInput, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { NativeAlarmManager } from 'rn-native-alarmkit';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { archiveScheduledNotifications, getAllScheduledNotificationData, saveScheduledNotificationData } from '@/utils/database';
import * as Crypto from 'expo-crypto';
import { DefaultKeyboardToolbarTheme, KeyboardAwareScrollView, KeyboardToolbar, KeyboardToolbarProps } from 'react-native-keyboard-controller';


// Maximum number of scheduled notifications allowed on the device
// const MAX_SCHEDULED_NOTIFICATION_COUNT = (Platform.OS === 'ios' ? 64 : 25);
const MAX_SCHEDULED_NOTIFICATION_COUNT = (Platform.OS === 'ios' ? 4 : 25);
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


// Listen for alarm events
// Listen for alarm fired events
const unsubscribe = NativeAlarmManager.onAlarmFired((event) => {
  console.log('Alarm fired:', event.alarm.id);

  // Access custom data
  if (event.alarm.config.data) {
    console.log('Alarm data:', event.alarm.config.data);
    // Update your app's state, log medication taken, etc.
  }

  // Check which action was taken
  if (event.action) {
    console.log('Action taken:', event.action.actionId);
  }
});

// Later: cleanup
unsubscribe();

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

export default function NotificationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    date?: string;
    title?: string;
    message?: string;
    note?: string;
    link?: string;
    repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  }>();

  // Initialize state from params if available
  const [title, setTitle] = useState(params.title || '');
  const [message, setMessage] = useState(params.message || '');
  const [note, setNote] = useState(params.note || '');
  const [link, setLink] = useState(params.link || '');
  const [selectedDate, setSelectedDate] = useState(
    params.date ? new Date(params.date) : new Date()
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
    (params.repeat as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly') || 'none'
  );

  // Memoize minimum date to prevent creating new Date object on each render
  const minimumDate = useMemo(() => new Date(), []);

  // Check if scheduled notifications count has reached the maximum
  const checkNotificationLimit = useCallback(async (): Promise<boolean> => {
    try {
      // Archive past notifications first
      await archiveScheduledNotifications();
      // Get all scheduled notifications
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
          [
            {
              text: 'OK',
              onPress: () => {
                // Navigate to home screen with "Upcoming" tab (default is 'scheduled')
                router.push('/(tabs)/home');
              },
            },
          ]
        );
        return true; // Limit reached
      }
      return false; // Limit not reached
    } catch (error) {
      console.error('Failed to check scheduled notifications count:', error);
      return false;
    }
  }, [router]);

  // Check scheduled notifications count when screen is focused (switching from another tab)
  useFocusEffect(
    useCallback(() => {
      checkNotificationLimit();
    }, [checkNotificationLimit])
  );

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
          // Don't request permission here - wait until user actually tries to schedule an alarm
          // This ensures the permission dialog appears at the right time
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

  // Update fields when params change (e.g., when navigating from calendar)
  useEffect(() => {
    if (params.date) {
      setSelectedDate(new Date(params.date));
    }
    if (params.title) {
      setTitle(params.title);
    }
    if (params.message) {
      setMessage(params.message);
    }
    if (params.note) {
      setNote(params.note);
    }
    if (params.link) {
      setLink(params.link);
    }
    if (params.repeat) {
      setRepeatOption(params.repeat as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly');
    }
  }, [params.date, params.title, params.message, params.note, params.link, params.repeat]);

  // Memoize form onLayout handler
  const handleFormLayout = useCallback((event: any) => {
    // Track form's top position in ScrollView content
    // onLayout gives position relative to ScrollView content (which includes padding)
    const { y } = event.nativeEvent.layout;
    formTopInContent.current = y;
  }, []);

  // Memoize button onLayout handler
  const handleButtonLayout = useCallback((event: any) => {
    // Track button's bottom position relative to form top
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
    // Ensure positions are measured
    if (formTopInContent.current === 0 || buttonBottomInForm.current === 0) {
      // console.log('Positions not yet measured, retrying...');
      setTimeout(() => scrollToShowButton(keyboardHeight), 100);
      return;
    }

    const screenHeight = Dimensions.get('window').height;
    const gap = 10; // Gap between button and keyboard

    // Calculate button bottom position in ScrollView content
    const buttonBottomInContent = formTopInContent.current + buttonBottomInForm.current;
    const visibleHeight = screenHeight - keyboardHeight;

    // Calculate scroll position: we want button bottom at (visibleHeight - gap) from top
    // scrollY + visibleHeight - gap = buttonBottomInContent
    // scrollY = buttonBottomInContent - visibleHeight + gap
    let targetScrollY = buttonBottomInContent - visibleHeight + gap;

    // Add extra padding to ensure button is well above keyboard
    targetScrollY += 20;

    // Scroll directly to the calculated position
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
      return; // Don't show date picker if limit is reached
    }
    Keyboard.dismiss();
    setShowDatePicker(true);
  }, [checkNotificationLimit]);

  const handleRepeatButtonPress = useCallback(async () => {
    const limitReached = await checkNotificationLimit();
    if (limitReached) {
      return; // Don't show repeat picker if limit is reached
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
    // Mark that we're about to scroll for focus
    hasScrolledForFocus.current = true;

    // Wait for keyboard to appear, then scroll to show button
    setTimeout(() => {
      if (keyboardHeightRef.current > 0) {
        scrollToShowButton(keyboardHeightRef.current);
      } else {
        // Fallback: use estimated keyboard height
        const estimatedKeyboardHeight = Platform.OS === 'ios' ? 336 : 300;
        scrollToShowButton(estimatedKeyboardHeight);
      }
    }, Platform.OS === 'ios' ? 400 : 500);
  }, [checkNotificationLimit, scrollToShowButton]);

  const handleLinkBlur = useCallback(() => {
    // When input loses focus, scroll to top
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
          // Wait for keyboard to appear, then scroll
          setTimeout(() => {
            scrollToShowButton(keyboardHeightRef.current);
          }, Platform.OS === 'ios' ? 350 : 450);
        }
      }
    );

    const keyboardWillHideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        // Scroll to top when keyboard hides if we scrolled for focus
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
  };

  const scheduleNotification = async () => {
    console.log('=== SCHEDULE NOTIFICATION ===');

    if (!message.trim()) {
      Alert.alert('Error', 'Please fill in the message');
      return;
    }

    console.log('Selected date:', selectedDate);
    if (selectedDate <= new Date()) {
      Alert.alert('Error', 'Please select a future date and time');
      return;
    }

    // Remove seconds from the selected date
    const dateWithoutSeconds = new Date(selectedDate);
    dateWithoutSeconds.setSeconds(0, 0);

    const notificationId = "thenotifier-" + Crypto.randomUUID();
    const notificationTitle = title || 'Personal';

    try {

      // Set notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('thenotifier', {
          name: 'The Notifier notifications',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'thenotifier.wav', // Provide ONLY the base filename
        });
      }

      // Create deep link URL for notification tap (works when app is backgrounded)
      const deepLinkUrl = (link) ? `thenotifier://notification?message=${encodeURIComponent(message)}&link=${encodeURIComponent(link)}` : `thenotifier://notification?message=${encodeURIComponent(message)}`;
      console.log('deepLinkUrl:', deepLinkUrl);


      let notificationContent: Notifications.NotificationContentInput = {
        title: notificationTitle,
        body: message,
        data: {
          title: title,
          message: message,
          note: note,
          link: link ? link : '',
          url: deepLinkUrl
        },
        sound: 'thenotifier.wav'
      };
      if (Platform.OS === 'android') {
        // vibrate is Android-only
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

      // Build trigger - channelId is Android-only
      // const trigger: Notifications.NotificationTriggerInput = {
      //   type: triggerType,
      //   date: dateWithoutSeconds,
      // };
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

      console.log('Notification scheduled successfully, saving notification data...');
      await saveScheduledNotificationData(notificationId, notificationTitle, message, note, link ? link : '', dateWithoutSeconds.toISOString(), dateWithoutSeconds.toLocaleString(), repeatOption, notificationTrigger, scheduleAlarm && alarmSupported);
      console.log('Notification data saved successfully');

      // Schedule alarm if enabled
      if (scheduleAlarm && alarmSupported) {
        try {
          // Check capability before scheduling
          const capability = await NativeAlarmManager.checkCapability();
          console.log('Alarm capability before scheduling:', capability);

          // Check authorization status
          let authStatus = capability.platformDetails?.alarmKitAuthStatus;
          console.log('AlarmKit auth status:', authStatus);

          // Request permission if needed
          if (capability.requiresPermission) {
            // If permission is not determined, try to request it
            if (authStatus === 'notDetermined' && capability.canRequestPermission) {
              try {
                console.log('Requesting alarm permission...');
                const granted = await NativeAlarmManager.requestPermission();
                console.log('Alarm permission granted:', granted);

                if (!granted) {
                  // Permission was denied by user
                  Alert.alert(
                    'Alarm Permission Denied',
                    'Alarm permission was denied. To schedule alarms, please grant permission when prompted. You may need to delete and reinstall the app to be prompted again.',
                    [{ text: 'OK' }]
                  );
                  resetForm();
                  return; // Don't schedule alarm if permission denied
                }

                // Re-check capability after permission request to verify it's authorized
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

                // Make sure to update the auth status to the new value
                authStatus = postRequestAuthStatus;
              } catch (permissionError) {
                console.error('Failed to request alarm permission:', permissionError);
                const errorMsg = permissionError instanceof Error ? permissionError.message : String(permissionError);

                // If permission request fails, check if it's because permission was already denied
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
                  // Permission request failed for another reason - show the error
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
              // Permission was previously denied
              Alert.alert(
                'Alarm Permission Denied',
                'Alarm permission was previously denied. To schedule alarms, please delete and reinstall the app to be prompted for permission again.',
                [{ text: 'OK' }]
              );
              resetForm();
              return;
            } else if (authStatus !== 'authorized') {
              // Permission status is unknown or not authorized
              Alert.alert(
                'Alarm Permission Required',
                'Alarm permission is required but not granted. Please try scheduling again to be prompted for permission.',
                [{ text: 'OK' }]
              );
              resetForm();
              return;
            }

            // Only proceed if permission is authorized
            if (authStatus !== 'authorized') {
              console.log('Alarm permission not authorized, cannot schedule');
              resetForm();
              return;
            }
          }

          // Extract hour and minutes from the selected date
          const hour = dateWithoutSeconds.getHours();
          const minutes = dateWithoutSeconds.getMinutes();

          // Use 'fixed' type for one-time alarm with specific date and time
          const alarmId = `alarm-${notificationId}`;
          console.log('Scheduling alarm...');
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
              title: 'The Notifier',
              body: message,
              sound: 'default',
              category: 'notifications',
              data: {
                notificationId: notificationId,
              },
              actions: [
                { id: 'dismiss', title: 'Dismiss', behavior: 'dismiss' },
                { id: 'snooze', title: 'Snooze 10m', behavior: 'snooze', snoozeDuration: 10 },
              ]
            },
          );

          console.log('Alarm scheduled successfully for:', dateWithoutSeconds);
        } catch (error) {
          console.error('Failed to schedule alarm:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);

          // AlarmKit permissions don't appear in Settings - they're handled by system dialogs
          // If permission was denied, the system dialog should have appeared
          if (errorMessage.includes('permission') || errorMessage.includes('Permission') || errorMessage.includes('authorization')) {
            Alert.alert(
              'Alarm Permission Required',
              'Unable to schedule alarm. AlarmKit requires permission to schedule alarms. If you denied the permission dialog, you may need to delete and reinstall the app to be prompted again, or the system may prompt you when you try to schedule an alarm.',
              [{ text: 'OK' }]
            );
          } else {
            Alert.alert('Warning', `Notification scheduled, but failed to schedule alarm: ${errorMessage}`);
          }
        }
      }

      Alert.alert('Success', 'Notification scheduled successfully!');
      console.log('Notification scheduled with ID:', notificationId);
      console.log('Notification selected date:', dateWithoutSeconds);
      console.log('Notification title:', notificationTitle);
      console.log('Notification message:', message);
      console.log('Notification note:', note);
      console.log('Notification link:', link);
    } catch (error) {
      Alert.alert('Error', 'Failed to schedule notification');
      console.error(error);
      console.error('Failed to schedule notification with ID:', notificationId);
      console.error('Failed selected date:', dateWithoutSeconds);
      console.error('Failed title:', notificationTitle);
      console.error('Failed message:', message);
      console.error('Failed note:', note);
      console.error('Failed link:', link);
    }
    resetForm();
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
    // Check if we need to archive any scheduled notifications
    (async () => {
      await archiveScheduledNotifications();
    })();
  }, []);

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
        {/* <ThemedText type="title">Schedule Notification</ThemedText> */}
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
                  <ThemedText type="subtitle">Create Alarm</ThemedText>
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
              <ThemedText style={scheduleButtonTextStyle}>Schedule Notification</ThemedText>
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
    // paddingBottom: 400, // Extra padding to ensure link input has space above keyboard
  },
  header: {
    // marginBottom: 30,
    marginTop: 40,
    padding: 20,
  },
  form: {
    gap: 20,
  },
  inputGroup: {
    gap: 8,
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
    // borderWidth: 1,
    // borderRadius: 8,
    padding: 12,
    minHeight: 50,
  },
});