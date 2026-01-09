import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import * as Notifications from 'expo-notifications';
import { NativeAlarmManager } from 'notifier-alarm-manager';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Keyboard, PixelRatio, Platform, StyleSheet, Switch, TextInput, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { cancelAlarmKitForParent, cancelExpoForParent } from '@/utils/cancel-scheduling';
import { archiveScheduledNotifications, deleteScheduledNotification, getAlarmPermissionDenied, getAllActiveDailyAlarmInstances, getWindowSize, markAllDailyAlarmInstancesCancelled, markAllRepeatNotificationInstancesCancelled, saveAlarmPermissionDenied, saveScheduledNotificationData, scheduleDailyAlarmWindow, scheduleRollingWindowNotifications } from '@/utils/database';
import { useT } from '@/utils/i18n';
import { logger, makeLogHeader } from '@/utils/logger';
import { ANDROID_NOTIFICATION_CHANNEL_ID, ensureAndroidNotificationChannel } from '@/utils/notification-channel';
import { getPermissionInstructions } from '@/utils/permissions';
import {
  isNextDailyOccurrence,
  isNextWeeklyOccurrence,
  mapJsMonthToExpoMonth,
  mapJsWeekdayToExpoWeekday,
} from '@/utils/repeat-start-date';
import * as Crypto from 'expo-crypto';
import { DefaultKeyboardToolbarTheme, KeyboardAwareScrollView, KeyboardToolbar, KeyboardToolbarProps } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toast } from 'toastify-react-native';

const LOG_FILE = 'components/scheduleForm.tsx';

// Maximum number of scheduled notifications allowed on the device
const MAX_SCHEDULED_NOTIFICATION_COUNT = (Platform.OS === 'ios' ? 64 : 25);
logger.info(makeLogHeader(LOG_FILE), 'Maximum scheduled notification count for', Platform.OS, ':', MAX_SCHEDULED_NOTIFICATION_COUNT);

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
    primary: Platform.OS === 'android' ? "#ffffff" : "#8ddaff",
    background: Platform.OS === 'android' ? "#2d2d2d" : "#1d1d1d",
  },
  light: {
    ...DefaultKeyboardToolbarTheme.light,
    primary: "#242424",
    background: "#D0E8FC",
  },
};

// Shared alarm actions definition - used for both daily-window and non-daily alarms
const ALARM_ACTIONS = [
  {
    id: 'dismiss',
    title: 'Dismiss',
    behavior: 'dismiss' as const,
    icon: Platform.select({
      ios: 'xmark',
      android: 'ic_cancel'
    })
  },
  {
    id: 'snooze',
    title: 'Snooze 10m',
    behavior: 'snooze' as const,
    snoozeDuration: 10, // 10 minutes to match the label
    icon: Platform.select({
      // Use a known-good SF Symbol name to avoid AlarmKit rejecting the configuration.
      ios: 'clock.arrow.circlepath',
      android: 'ic_snooze'
    })
  },
];

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
  location?: string;
  originalEventTitle?: string;
  originalEventStartDate?: string;
  originalEventEndDate?: string;
  originalEventLocation?: string;
  originalEventRecurring?: string;
}

export interface ScheduleFormProps {
  initialParams?: ScheduleFormParams;
  isEditMode: boolean;
  source?: 'home' | 'calendar' | 'tab' | 'schedule';
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ScheduleForm({ initialParams, isEditMode, source = 'schedule', onSuccess, onCancel }: ScheduleFormProps) {
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
  const t = useT();
  const insets = useSafeAreaInsets();

  // On Android, detect if using button navigation vs gesture navigation
  // Button navigation typically has bottom inset of 16-24px
  // Gesture navigation typically has bottom inset of 0-8px
  // Note: Safe area insets may not update dynamically when navigation mode changes
  // The app may need to be restarted for changes to take effect
  // Using a threshold of 16px to distinguish between button (>=16px) and gesture (<16px)
  const isButtonNavigation = Platform.OS === 'android' && insets.bottom >= 16;
  const scrollViewRef = useRef<any>(null);
  const messageInputRef = useRef<TextInput>(null);
  const noteInputRef = useRef<TextInput>(null);
  const linkInputRef = useRef<TextInput>(null);
  const scheduleButtonRef = useRef<any>(null);
  const formTopInContent = useRef<number>(0);
  const buttonBottomInForm = useRef<number>(0);
  const keyboardHeightRef = useRef<number>(0);
  const hasScrolledForFocus = useRef<boolean>(false);
  const [scheduleAlarm, setScheduleAlarm] = useState(false); // Will be set correctly in useEffect
  const [alarmSupported, setAlarmSupported] = useState(false);
  const [alarmPermissionDenied, setAlarmPermissionDenied] = useState(false);
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

  // Check stored alarm permission denial state on mount and set initial scheduleAlarm state
  useEffect(() => {
    (async () => {
      try {
        const denied = await getAlarmPermissionDenied();
        let currentDenied = denied;

        // Always check current alarm permission status directly
        try {
          const capability = await NativeAlarmManager.checkCapability();
          const authStatus = capability.platformDetails?.alarmKitAuthStatus;

          // Update denial state based on current permission status
          if (capability.requiresPermission) {
            if (authStatus === 'denied') {
              currentDenied = true;
              if (!denied) {
                // Permissions were revoked, update stored state
                await saveAlarmPermissionDenied(true);
              }
            } else if (authStatus === 'authorized') {
              currentDenied = false;
              if (denied) {
                // Permissions were re-enabled, clear stored state
                await saveAlarmPermissionDenied(false);
              }
            }
          } else {
            // No permission required, not denied
            currentDenied = false;
            if (denied) {
              await saveAlarmPermissionDenied(false);
            }
          }
        } catch (capabilityError) {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to check alarm capability:', capabilityError);
          // If we can't check, use stored state
        }

        setAlarmPermissionDenied(currentDenied);

        // For new notifications (not edit mode), set default based on source and current denial state
        if (!isEditMode) {
          // Only set to true if permissions are NOT denied
          if ((source === 'tab' || source === 'calendar' || source === 'schedule') && !currentDenied) {
            setScheduleAlarm(true);
          } else {
            setScheduleAlarm(false);
          }
        } else {
          // For edit mode, use initialParams.hasAlarm if provided
          if (initialParams?.hasAlarm === 'true') {
            setScheduleAlarm(true);
          } else if (initialParams?.hasAlarm === 'false') {
            setScheduleAlarm(false);
          }
        }
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE), 'Failed to check alarm permission denied state:', error);
        // Default to false on error
        if (!isEditMode) {
          setScheduleAlarm(false);
        }
      }
    })();
  }, [isEditMode, source]);

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
        // For edit mode, check if alarm permissions are denied
        if (isEditMode) {
          (async () => {
            try {
              const capability = await NativeAlarmManager.checkCapability();
              const authStatus = capability.platformDetails?.alarmKitAuthStatus;

              if (authStatus === 'denied' || (capability.requiresPermission && authStatus !== 'authorized')) {
                // Alarm permissions are denied, remove alarm from notification
                Alert.alert(
                  t('alertTitles.alarmPermissionRequired'),
                  t('alertMessages.alarmWillBeRemoved')
                );

                // Cancel the existing alarm
                if (initialParams.notificationId) {
                  const alarmId = initialParams.notificationId.substring("thenotifier-".length);
                  try {
                    const existingAlarm = await NativeAlarmManager.getAlarm(alarmId);
                    if (existingAlarm) {
                      await NativeAlarmManager.cancelAlarm(alarmId);
                      logger.info(makeLogHeader(LOG_FILE), 'Cancelled existing alarm due to denied permissions:', alarmId);
                    }
                  } catch (alarmError) {
                    const errorMessage = alarmError instanceof Error ? alarmError.message : String(alarmError);
                    if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
                      logger.error(makeLogHeader(LOG_FILE), 'Failed to cancel existing alarm:', alarmId, ', error:', alarmError);
                    }
                  }
                }

                setScheduleAlarm(false);
                setEditingHasAlarm(false);
              } else {
                setScheduleAlarm(true);
              }
            } catch (error) {
              logger.error(makeLogHeader(LOG_FILE), 'Failed to check alarm capability in edit mode:', error);
              setScheduleAlarm(true);
            }
          })();
        } else {
          setScheduleAlarm(true);
        }
      } else if (initialParams.hasAlarm === 'false') {
        setEditingHasAlarm(false);
        setScheduleAlarm(false);
      }
    }
  }, [initialParams, isEditMode]);

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
        logger.info(makeLogHeader(LOG_FILE, 'checkNotificationLimit'), 'Maximum notifications reached:', count);
        Alert.alert(
          t('alertTitles.maximumNotificationsReached'),
          t('alertMessages.maxNotificationsReached', { max: MAX_SCHEDULED_NOTIFICATION_COUNT }),
          [{ text: t('buttonText.ok') }]
        );
        return true; // Limit reached
      }
      return false; // Limit not reached
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'checkNotificationLimit'), 'Failed to check scheduled notifications count:', error);
      return false;
    }
  }, [isEditMode]);

  useEffect(() => {
    // Request permissions
    (async () => {
      // Android: Ensure notification channel is set up before requesting permissions
      // This is required per Expo docs - channel must exist before permissions prompt will appear
      if (Platform.OS === 'android') {
        try {
          await ensureAndroidNotificationChannel();
          logger.info(makeLogHeader(LOG_FILE), 'Android notification channel ensured before permission request');
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to ensure Android notification channel before permission request:', error);
          // Continue anyway - channel might already exist from app initialization
        }
      }

      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        // Don't show alert here - will be handled when user tries to schedule
      }

      // Check if alarm module is available
      try {
        const capability = await NativeAlarmManager.checkCapability();
        logger.info(makeLogHeader(LOG_FILE), 'Alarm capability check:', capability);

        if (capability.capability !== 'none') {
          setAlarmSupported(true);

          // Always check and update current permission status
          if (capability.requiresPermission) {
            const authStatus = capability.platformDetails?.alarmKitAuthStatus;

            // Update denial state based on current status
            if (authStatus === 'denied') {
              await saveAlarmPermissionDenied(true);
              setAlarmPermissionDenied(true);
              if (!isEditMode) {
                setScheduleAlarm(false);
              }
            } else if (authStatus === 'authorized') {
              await saveAlarmPermissionDenied(false);
              setAlarmPermissionDenied(false);
              // If creating new notification, set scheduleAlarm to true
              if (!isEditMode && (source === 'tab' || source === 'calendar' || source === 'schedule')) {
                setScheduleAlarm(true);
              }
            }

            // Request alarm permissions immediately after notification permissions if not determined
            if (status === 'granted' && authStatus === 'notDetermined' && capability.canRequestPermission) {
              try {
                logger.info(makeLogHeader(LOG_FILE), 'Requesting alarm permission proactively...');
                const granted = await NativeAlarmManager.requestPermission();
                logger.info(makeLogHeader(LOG_FILE), 'Alarm permission granted:', granted);

                if (granted) {
                  // Clear denial state if permission was granted
                  await saveAlarmPermissionDenied(false);
                  setAlarmPermissionDenied(false);
                  // If creating new notification, set scheduleAlarm to true
                  if (!isEditMode && (source === 'tab' || source === 'calendar' || source === 'schedule')) {
                    setScheduleAlarm(true);
                  }
                } else {
                  // Permission denied, save state
                  await saveAlarmPermissionDenied(true);
                  setAlarmPermissionDenied(true);
                  if (!isEditMode) {
                    setScheduleAlarm(false);
                  }
                }
              } catch (permissionError) {
                logger.error(makeLogHeader(LOG_FILE), 'Failed to request alarm permission:', permissionError);
                const errorCheckCapability = await NativeAlarmManager.checkCapability();
                const errorCheckAuthStatus = errorCheckCapability.platformDetails?.alarmKitAuthStatus;

                if (errorCheckAuthStatus === 'denied') {
                  await saveAlarmPermissionDenied(true);
                  setAlarmPermissionDenied(true);
                  if (!isEditMode) {
                    setScheduleAlarm(false);
                  }
                }
              }
            }
          } else {
            // No permission required, clear denial state
            await saveAlarmPermissionDenied(false);
            setAlarmPermissionDenied(false);
            if (!isEditMode && (source === 'tab' || source === 'calendar' || source === 'schedule')) {
              setScheduleAlarm(true);
            }
          }
        } else {
          setAlarmSupported(false);
          logger.info(makeLogHeader(LOG_FILE), 'Alarms are not supported on this device');
        }
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE), 'Alarm module error:', error);
        setAlarmSupported(false);
      }
    })();
  }, [isEditMode, source]);

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

  // Handle Android date/time picker using native API
  // Android requires separate date and time pickers
  const handleAndroidDateTimePicker = useCallback(() => {
    // First show date picker
    DateTimePickerAndroid.open({
      value: selectedDate,
      mode: 'date',
      onChange: (event, date) => {
        if (event.type === 'set' && date) {
          // Update date but keep the time
          const updatedDate = new Date(date);
          updatedDate.setHours(selectedDate.getHours());
          updatedDate.setMinutes(selectedDate.getMinutes());
          setSelectedDate(updatedDate);

          // Then show time picker after a short delay
          setTimeout(() => {
            DateTimePickerAndroid.open({
              value: updatedDate,
              mode: 'time',
              is24Hour: false,
              onChange: (timeEvent, timeDate) => {
                if (timeEvent.type === 'set' && timeDate) {
                  setSelectedDate(timeDate);
                }
              },
              positiveButton: { label: 'OK', textColor: colors.tint },
              negativeButton: { label: 'Cancel', textColor: colors.text },
            });
          }, 300);
        }
      },
      minimumDate: minimumDate,
      positiveButton: { label: 'OK', textColor: colors.tint },
      negativeButton: { label: 'Cancel', textColor: colors.text },
    });
  }, [selectedDate, minimumDate, colors.tint, colors.text]);

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

  const pickerContainerStyle = useMemo(() => [
    styles.pickerContainer,
    { borderColor: colors.icon, backgroundColor: colors.background }
  ], [colors.icon, colors.background]);

  // Memoize callbacks
  const handleDateButtonPress = useCallback(async () => {
    const limitReached = await checkNotificationLimit();
    if (limitReached) {
      return;
    }
    Keyboard.dismiss();
    if (Platform.OS === 'android') {
      handleAndroidDateTimePicker();
    } else {
      setShowDatePicker(true);
    }
  }, [checkNotificationLimit, handleAndroidDateTimePicker]);

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
        return t('repeatOptions.doNotRepeat');
      case 'daily':
        return t('repeatOptions.repeatEveryDay');
      case 'weekly':
        return t('repeatOptions.repeatEveryWeek');
      case 'monthly':
        return t('repeatOptions.repeatEveryMonth');
      case 'yearly':
        return t('repeatOptions.repeatEveryYear');
      default:
        return t('repeatOptions.doNotRepeat');
    }
  }, [t]);

  const handleDonePress = useCallback(() => {
    setShowDatePicker(false);
  }, []);

  const handleMessageChange = useCallback((text: string) => {
    const MAX_LENGTH = 60;
    if (text.length > MAX_LENGTH) {
      setMessage(text.substring(0, MAX_LENGTH));
      Toast.show({
        type: 'error',
        text1: t('toastMessages.messageLimitExceeded'),
        position: 'top',
        visibilityTime: 2000,
        autoHide: true,
        backgroundColor: '#8B0000', // Dark red
        textColor: '#f0f0f0', // Light text
      });
    } else {
      setMessage(text);
    }
  }, [t]);

  const handleNoteChange = useCallback((text: string) => {
    const MAX_LENGTH = 240;
    if (text.length > MAX_LENGTH) {
      setNote(text.substring(0, MAX_LENGTH));
      Toast.show({
        type: 'error',
        text1: t('toastMessages.noteLimitExceeded'),
        position: 'top',
        visibilityTime: 2000,
        autoHide: true,
        backgroundColor: '#8B0000', // Dark red
        textColor: '#f0f0f0', // Light text
      });
    } else {
      setNote(text);
    }
  }, [t]);

  const handleLinkChange = useCallback((text: string) => {
    const MAX_LENGTH = 2048;
    if (text.length > MAX_LENGTH) {
      setLink(text.substring(0, MAX_LENGTH));
      Toast.show({
        type: 'error',
        text1: t('toastMessages.linkLimitExceeded'),
        position: 'top',
        visibilityTime: 2000,
        autoHide: true,
        backgroundColor: '#8B0000', // Dark red
        textColor: '#f0f0f0', // Light text
      });
    } else {
      setLink(text);
    }
  }, [t]);

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

  // Handle alarm switch toggle with permission check
  const handleAlarmSwitchChange = useCallback(async (value: boolean) => {
    if (value) {
      // User is trying to enable alarm - check permissions
      try {
        const capability = await NativeAlarmManager.checkCapability();
        const authStatus = capability.platformDetails?.alarmKitAuthStatus;

        if (capability.requiresPermission && authStatus === 'denied') {
          // Permissions denied, show alert with instructions
          Alert.alert(
            t('alertTitles.alarmPermissionRequired'),
            getPermissionInstructions('alarm'),
            [{ text: t('buttonText.ok') }]
          );
          // Don't change the switch value
          return;
        } else if (capability.requiresPermission && authStatus === 'notDetermined' && capability.canRequestPermission) {
          // Try to request permission
          try {
            const granted = await NativeAlarmManager.requestPermission();
            if (!granted) {
              Alert.alert(
                t('alertTitles.alarmPermissionRequired'),
                getPermissionInstructions('alarm'),
                [{ text: t('buttonText.ok') }]
              );
              await saveAlarmPermissionDenied(true);
              setAlarmPermissionDenied(true);
              return;
            } else {
              // Permission granted, clear denial state
              await saveAlarmPermissionDenied(false);
              setAlarmPermissionDenied(false);
            }
          } catch (permissionError) {
            logger.error(makeLogHeader(LOG_FILE, 'handleAlarmToggle'), 'Failed to request alarm permission:', permissionError);
            const errorCheckCapability = await NativeAlarmManager.checkCapability();
            const errorCheckAuthStatus = errorCheckCapability.platformDetails?.alarmKitAuthStatus;

            if (errorCheckAuthStatus === 'denied') {
              Alert.alert(
                t('alertTitles.alarmPermissionRequired'),
                getPermissionInstructions('alarm'),
                [{ text: t('buttonText.ok') }]
              );
              await saveAlarmPermissionDenied(true);
              setAlarmPermissionDenied(true);
              return;
            }
          }
        } else if (capability.requiresPermission && authStatus !== 'authorized') {
          // Not authorized, show alert
          Alert.alert(
            t('alertTitles.alarmPermissionRequired'),
            getPermissionInstructions('alarm'),
            [{ text: t('buttonText.ok') }]
          );
          return;
        }

        // Permission check passed, allow the switch to be enabled
        setScheduleAlarm(true);
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'handleAlarmToggle'), 'Failed to check alarm capability:', error);
        Alert.alert(
          'Alarm Permission Required',
          getPermissionInstructions('alarm'),
          [{ text: 'OK' }]
        );
        return;
      }
    } else {
      // User is disabling alarm, just update the state
      setScheduleAlarm(false);
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

  const resetForm = async () => {
    setMessage('');
    setNote('');
    setLink('');
    setTitle('');
    setSelectedDate(new Date());

    // Check current alarm permission status before setting scheduleAlarm
    // Only check if alarms are supported to avoid errors when native module isn't available
    let shouldEnableAlarm = false;
    if (!isEditMode && (source === 'tab' || source === 'calendar' || source === 'schedule') && alarmSupported) {
      try {
        // Check stored denial state
        const denied = await getAlarmPermissionDenied();

        // Also check current permission status
        try {
          const capability = await NativeAlarmManager.checkCapability();
          const authStatus = capability.platformDetails?.alarmKitAuthStatus;

          if (capability.requiresPermission && authStatus === 'denied') {
            shouldEnableAlarm = false;
            // Update stored state if needed
            if (!denied) {
              await saveAlarmPermissionDenied(true);
              setAlarmPermissionDenied(true);
            }
          } else if (!denied && (authStatus === 'authorized' || !capability.requiresPermission)) {
            shouldEnableAlarm = true;
          } else {
            shouldEnableAlarm = false;
          }
        } catch (capabilityError) {
          // If we can't check capability, use stored denial state
          logger.error(makeLogHeader(LOG_FILE, 'resetForm'), 'Failed to check alarm capability in resetForm:', capabilityError);
          shouldEnableAlarm = !denied;
        }
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'resetForm'), 'Failed to check alarm permission in resetForm:', error);
        shouldEnableAlarm = false;
      }
    }

    setScheduleAlarm(shouldEnableAlarm);
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
          t('alertTitles.cancelEdit'),
          t('alertMessages.cancelEditConfirmation'),
          [
            {
              text: t('buttonText.ok'),
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
    logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '=== SCHEDULE NOTIFICATION ===');

    // Check notification permissions first
    try {
      const notificationPermissions = await Notifications.getPermissionsAsync();
      if (notificationPermissions.status !== 'granted') {
        Alert.alert(
          t('alertTitles.notificationPermissionRequired'),
          t('alertMessages.notificationPermissionRequired', { instructions: getPermissionInstructions('notification') }),
          [{ text: t('buttonText.ok') }]
        );
        return;
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to check notification permissions:', error);
      Alert.alert(
        t('alertTitles.notificationPermissionRequired'),
        t('alertMessages.notificationPermissionRequired', { instructions: getPermissionInstructions('notification') }),
        [{ text: t('buttonText.ok') }]
      );
      return;
    }

    if (!message.trim()) {
      Alert.alert(t('alertTitles.error'), t('alertMessages.forgotMessage'));
      return;
    }

    logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Selected date:', selectedDate);

    const dateWithoutSeconds = new Date(selectedDate);
    dateWithoutSeconds.setSeconds(0, 0);

    const now = new Date();
    const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

    if (dateWithoutSeconds <= oneMinuteFromNow) {
      Alert.alert(t('alertTitles.error'), t('alertMessages.selectFutureDate'));
      return;
    }

    // If in edit mode, cancel existing notification and alarm, then delete from DB
    if (isEditMode && editingNotificationId) {
      try {
        // Get existing notification to determine repeatOption for proper alarm cancellation
        const { getAllScheduledNotificationData } = await import('@/utils/database');
        const allNotifications = await getAllScheduledNotificationData();
        const existingNotification = allNotifications.find(n => n.notificationId === editingNotificationId);
        const existingRepeatOption = existingNotification?.repeatOption ?? repeatOption ?? null;

        // Cancel all Expo scheduled notifications (main + rolling-window instances)
        // Always attempt cancellation regardless of DB state (idempotent)
        await cancelExpoForParent(editingNotificationId);
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Cancelled all Expo notifications for edit:', editingNotificationId);

        // Cancel all AlarmKit alarms (daily and non-daily)
        // Always attempt cancellation regardless of editingHasAlarm flag (idempotent)
        // Android-only: Use dual-strategy cancellation to handle alarm-only vs notification-only toggle behavior
        if (Platform.OS === 'android') {
          // Cancel using both strategies to avoid repeatOption ambiguity
          // This ensures we catch all alarms regardless of DB state or daily-window instance tracking
          await cancelAlarmKitForParent(editingNotificationId, 'daily');
          await cancelAlarmKitForParent(editingNotificationId, null);
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[Android] Cancelled all AlarmKit alarms for edit using dual-strategy:', editingNotificationId);
        } else {
          // iOS: Use single-strategy cancellation based on existing repeatOption
          await cancelAlarmKitForParent(editingNotificationId, existingRepeatOption);
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Cancelled all AlarmKit alarms for edit:', editingNotificationId);
        }

        // Mark rolling-window instances as cancelled in DB (if any)
        const isRollingWindow = existingNotification?.notificationTrigger && (existingNotification.notificationTrigger as any).type === 'DATE_WINDOW';
        if (isRollingWindow) {
          await markAllRepeatNotificationInstancesCancelled(editingNotificationId);
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Marked all rolling-window notification instances as cancelled on edit');
        }

        await deleteScheduledNotification(editingNotificationId);
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Deleted existing notification from DB:', editingNotificationId);
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to cancel/delete existing notification:', error);
        Alert.alert(t('alertTitles.error'), t('alertMessages.failedToUpdate'));
        return;
      }
    }

    const notificationId = "thenotifier-" + Crypto.randomUUID();
    const notificationTitle = title || 'Personal';

    try {
      // Ensure Android notification channel is set up (idempotent)
      await ensureAndroidNotificationChannel();

      const deepLinkUrl = (link)
        ? `thenotifier://notification-display?title=${encodeURIComponent(notificationTitle)}&message=${encodeURIComponent(message)}&note=${encodeURIComponent(note)}&link=${encodeURIComponent(link)}`
        : `thenotifier://notification-display?title=${encodeURIComponent(notificationTitle)}&message=${encodeURIComponent(message)}&note=${encodeURIComponent(note)}&link=`;
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'deepLinkUrl:', deepLinkUrl);

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
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'notificationContent:', notificationContent);

      // Android: if an alarm is enabled, use alarm-only mode (do not schedule Expo notifications)
      // iOS: keep existing behavior (notifications + optional alarms)
      const useAndroidAlarmOnly = Platform.OS === 'android' && scheduleAlarm && alarmSupported;

      let notificationTrigger: Notifications.NotificationTriggerInput;
      let useRollingWindow = false;
      const hour = dateWithoutSeconds.getHours();
      const minute = dateWithoutSeconds.getMinutes();
      const day = dateWithoutSeconds.getDate();
      const dayOfWeek = dateWithoutSeconds.getDay();
      const month = dateWithoutSeconds.getMonth();

      // Map to Expo format
      const expoWeekday = mapJsWeekdayToExpoWeekday(dayOfWeek);
      const expoMonth = mapJsMonthToExpoMonth(month);

      const now = new Date();
      const nowMs = now.getTime();
      const selectedMs = dateWithoutSeconds.getTime();
      const diffMs = selectedMs - nowMs;
      const diffHours = diffMs / (60 * 60 * 1000);
      const diffDays = diffMs / (24 * 60 * 60 * 1000);

      // Calendar-based thresholds for monthly/yearly
      const oneMonthFromNow = new Date(now);
      oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
      const oneYearFromNow = new Date(now);
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      // Log decision inputs
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Decision inputs:', {
        nowISO: now.toISOString(),
        selectedISO: dateWithoutSeconds.toISOString(),
        selectedLocal: dateWithoutSeconds.toLocaleString(),
        diffMs: diffMs,
        diffHours: diffHours.toFixed(2),
        diffDays: diffDays.toFixed(2),
        repeatOption: repeatOption,
        hour: hour,
        minute: minute,
        jsWeekday: dayOfWeek,
        expoWeekday: expoWeekday,
        jsMonth: month,
        expoMonth: expoMonth,
        oneMonthFromNowISO: oneMonthFromNow.toISOString(),
        oneYearFromNowISO: oneYearFromNow.toISOString(),
      });

      switch (repeatOption) {
        case 'none':
          notificationTrigger = {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: dateWithoutSeconds,
          };
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] One-time notification, using DATE trigger');
          break;
        case 'daily':
          // Check if selected begin date matches the next daily occurrence
          // Only use Expo DAILY trigger if the first fire will be exactly on the selected date
          const isNextDaily = isNextDailyOccurrence(dateWithoutSeconds, hour, minute);

          if (isNextDaily) {
            // Use Expo DAILY trigger - it will fire at the selected time
            notificationTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: hour,
              minute: minute,
            };
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Daily repeat: using Expo DAILY trigger (selected date matches next occurrence)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              hour: hour,
              minute: minute,
            });
          } else {
            // Use rolling window to ensure first fire is exactly on selected date
            useRollingWindow = true;
            notificationTrigger = {
              type: 'DATE_WINDOW' as any,
              window: 'daily7',
            } as any;
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Daily repeat: using rollingWindow (selected date does not match next occurrence)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              hour: hour,
              minute: minute,
              diffMs: diffMs,
              windowSize: 7,
            });
          }
          break;
        case 'weekly':
          // Check if selected begin date matches the next weekly occurrence
          // Only use Expo WEEKLY trigger if the first fire will be exactly on the selected date
          const isNextWeekly = isNextWeeklyOccurrence(dateWithoutSeconds, expoWeekday, hour, minute);

          if (isNextWeekly) {
            // Use Expo WEEKLY trigger - it will fire at the selected time
            notificationTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: expoWeekday,
              hour: hour,
              minute: minute,
            };
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Weekly repeat: using Expo WEEKLY trigger (selected date matches next occurrence)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              jsWeekday: dayOfWeek,
              expoWeekday: expoWeekday,
              hour: hour,
              minute: minute,
            });
          } else {
            // Use rolling window to ensure first fire is exactly on selected date
            useRollingWindow = true;
            notificationTrigger = {
              type: 'DATE_WINDOW' as any,
              window: 'weekly4',
            } as any;
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Weekly repeat: using rollingWindow (selected date does not match next occurrence)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              jsWeekday: dayOfWeek,
              expoWeekday: expoWeekday,
              hour: hour,
              minute: minute,
              diffMs: diffMs,
              windowSize: 4,
            });
          }
          break;
        case 'monthly':
          // Keep calendar-based comparison for monthly but log it
          const monthlyComparison = dateWithoutSeconds >= oneMonthFromNow;
          if (monthlyComparison) {
            // Use rolling window
            useRollingWindow = true;
            notificationTrigger = {
              type: 'DATE_WINDOW' as any,
              window: 'monthly4',
            } as any;
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Monthly repeat: using rollingWindow (selected >= oneMonthFromNow)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              oneMonthFromNowISO: oneMonthFromNow.toISOString(),
              windowSize: 4,
            });
          } else {
            // Use existing MONTHLY trigger
            notificationTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
              day: day,
              hour: hour,
              minute: minute,
            };
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Monthly repeat: using Expo MONTHLY trigger (selected < oneMonthFromNow)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              oneMonthFromNowISO: oneMonthFromNow.toISOString(),
            });
          }
          break;
        case 'yearly':
          // Keep calendar-based comparison for yearly but log it
          const yearlyComparison = dateWithoutSeconds >= oneYearFromNow;
          if (yearlyComparison) {
            // Use rolling window
            useRollingWindow = true;
            notificationTrigger = {
              type: 'DATE_WINDOW' as any,
              window: 'yearly2',
            } as any;
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Yearly repeat: using rollingWindow (selected >= oneYearFromNow)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              oneYearFromNowISO: oneYearFromNow.toISOString(),
              windowSize: 2,
            });
          } else {
            // Use existing YEARLY trigger with corrected month mapping
            notificationTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.YEARLY,
              month: expoMonth,
              day: day,
              hour: hour,
              minute: minute,
            };
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Yearly repeat: using Expo YEARLY trigger (selected < oneYearFromNow)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              oneYearFromNowISO: oneYearFromNow.toISOString(),
              jsMonth: month,
              expoMonth: expoMonth,
            });
          }
          break;
      }

      // Alarm-only mode on Android: never schedule rolling-window notifications
      if (useAndroidAlarmOnly) {
        useRollingWindow = false;
      }

      // Log final decision with begin-date correctness details
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Final decision:', {
        useRollingWindow: useRollingWindow,
        notificationTriggerType: (notificationTrigger as any).type,
        repeatOption: repeatOption,
        selectedBeginDateISO: dateWithoutSeconds.toISOString(),
        selectedBeginDateLocal: dateWithoutSeconds.toLocaleString(),
        hour: hour,
        minute: minute,
        ...(repeatOption === 'weekly' && {
          jsWeekday: dayOfWeek,
          expoWeekday: expoWeekday,
        }),
        ...(repeatOption === 'yearly' && {
          jsMonth: month,
          expoMonth: expoMonth,
        }),
      });

      if (useAndroidAlarmOnly) {
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Android alarm-only mode: skipping notification scheduling');
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Saving notification with repeatMethod:', 'alarm');
        // Android alarm-only: Store notificationTrigger as null to prevent window replenishment code
        // from interpreting it as needing Expo window notifications
        await saveScheduledNotificationData(
          notificationId,
          notificationTitle,
          message,
          note,
          link ? link : '',
          dateWithoutSeconds.toISOString(),
          dateWithoutSeconds.toLocaleString(),
          repeatOption,
          null, // Store null instead of DATE_WINDOW trigger to prevent window replenishment
          scheduleAlarm && alarmSupported,
          initialParams?.calendarId,
          initialParams?.originalEventId,
          initialParams?.location,
          initialParams?.originalEventTitle,
          initialParams?.originalEventStartDate,
          initialParams?.originalEventEndDate,
          initialParams?.originalEventLocation,
          initialParams?.originalEventRecurring,
          'alarm'
        );
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm-only notification data saved successfully');
      } else if (useRollingWindow) {
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Using rollingWindow for notifications, repeatOption:', repeatOption);

        // Check OS notification limit before scheduling rolling window
        const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
        const windowSize = getWindowSize(repeatOption as 'daily' | 'weekly' | 'monthly' | 'yearly');
        const remainingCapacity = MAX_SCHEDULED_NOTIFICATION_COUNT - scheduledNotifications.length;

        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Notification capacity check:', {
          windowSize: windowSize,
          scheduledCount: scheduledNotifications.length,
          maxCapacity: MAX_SCHEDULED_NOTIFICATION_COUNT,
          remainingCapacity: remainingCapacity,
        });

        if (windowSize > remainingCapacity) {
          const neededToDelete = windowSize - remainingCapacity;
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Capacity exceeded, blocking scheduling:', {
            neededToDelete: neededToDelete,
          });
          Alert.alert(
            t('alertTitles.maximumNotificationsReached'),
            t('alertMessages.maxNotificationsCapacityExceeded', { needed: neededToDelete }),
            [{ text: t('buttonText.ok') }]
          );
          return;
        }

        // Schedule rolling window DATE notifications
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Scheduling rolling-window notification instances...');
        const result = await scheduleRollingWindowNotifications(
          notificationId,
          dateWithoutSeconds,
          repeatOption as 'daily' | 'weekly' | 'monthly' | 'yearly',
          notificationContent
        );

        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Rolling-window notification instances scheduled:', {
          scheduled: result.scheduled,
          skipped: result.skipped,
          repeatOption: repeatOption,
          windowSize: windowSize,
        });

        // Save parent notification record
        await saveScheduledNotificationData(notificationId, notificationTitle, message, note, link ? link : '', dateWithoutSeconds.toISOString(), dateWithoutSeconds.toLocaleString(), repeatOption, notificationTrigger, scheduleAlarm && alarmSupported, initialParams?.calendarId, initialParams?.originalEventId, initialParams?.location, initialParams?.originalEventTitle, initialParams?.originalEventStartDate, initialParams?.originalEventEndDate, initialParams?.originalEventLocation, initialParams?.originalEventRecurring, 'rollingWindow');
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Rolling-window notification data saved successfully');
      } else {
        // Use existing repeating trigger approach (Expo triggers)
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Using Expo repeating trigger approach');
        if (Platform.OS === 'android') {
          (notificationTrigger as any).channelId = ANDROID_NOTIFICATION_CHANNEL_ID;
        }
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'notificationTrigger:', notificationTrigger);

        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '=== SCHEDULE NOTIFICATION ASYNC ===');
        await Notifications.scheduleNotificationAsync({
          identifier: notificationId,
          content: notificationContent,
          trigger: notificationTrigger,
        });

        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Notification scheduled successfully, saving notification data...', notificationId, notificationTitle, message, note, link, dateWithoutSeconds.toISOString(), dateWithoutSeconds.toLocaleString(), repeatOption, notificationTrigger, scheduleAlarm && alarmSupported, initialParams?.calendarId, initialParams?.originalEventId, initialParams?.location);
        // Determine repeatMethod: 'expo' for Expo repeating triggers, null for one-time
        const repeatMethodValue = (repeatOption && repeatOption !== 'none' && !useRollingWindow) ? 'expo' : null;
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Saving notification with repeatMethod:', repeatMethodValue);
        await saveScheduledNotificationData(notificationId, notificationTitle, message, note, link ? link : '', dateWithoutSeconds.toISOString(), dateWithoutSeconds.toLocaleString(), repeatOption, notificationTrigger, scheduleAlarm && alarmSupported, initialParams?.calendarId, initialParams?.originalEventId, initialParams?.location, initialParams?.originalEventTitle, initialParams?.originalEventStartDate, initialParams?.originalEventEndDate, initialParams?.originalEventLocation, initialParams?.originalEventRecurring, repeatMethodValue);
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Notification data saved successfully');
      }

      // If editing and alarm is disabled, cancel all daily alarm instances
      // Only run this if alarms are actually supported
      if (isEditMode && !scheduleAlarm && editingHasAlarm && alarmSupported) {
        try {
          const { getAllScheduledNotificationData } = await import('@/utils/database');
          const allNotifications = await getAllScheduledNotificationData();
          const existingNotification = allNotifications.find(n => n.notificationId === notificationId);

          if (existingNotification?.repeatOption === 'daily') {
            // Cancel all daily alarm instances
            const dailyInstances = await getAllActiveDailyAlarmInstances(notificationId);
            for (const instance of dailyInstances) {
              try {
                await NativeAlarmManager.cancelAlarm(instance.alarmId);
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Cancelled daily alarm instance (alarm disabled):', instance.alarmId);
              } catch (instanceError) {
                const errorMessage = instanceError instanceof Error ? instanceError.message : String(instanceError);
                if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
                  logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to cancel daily alarm instance:', instance.alarmId, ', error:', instanceError);
                }
              }
            }
            await markAllDailyAlarmInstancesCancelled(notificationId);
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Marked all daily alarm instances as cancelled (alarm disabled)');
          }
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to cancel daily alarms when disabling alarm:', error);
          // Continue - don't block the update
        }
      }

      // Schedule alarm if enabled
      if (scheduleAlarm && alarmSupported) {
        try {
          const capability = await NativeAlarmManager.checkCapability();
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm capability before scheduling:', capability);

          let authStatus = capability.platformDetails?.alarmKitAuthStatus;
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'AlarmKit auth status:', authStatus);

          if (capability.requiresPermission) {
            if (authStatus === 'notDetermined' && capability.canRequestPermission) {
              try {
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Requesting alarm permission...');
                const granted = await NativeAlarmManager.requestPermission();
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm permission granted:', granted);

                if (!granted) {
                  await saveAlarmPermissionDenied(true);
                  setAlarmPermissionDenied(true);
                  Alert.alert(
                    t('alertTitles.alarmPermissionDenied'),
                    getPermissionInstructions('alarm'),
                    [{ text: t('buttonText.ok') }]
                  );
                  resetForm();
                  return;
                }

                // Permission granted, clear denial state
                await saveAlarmPermissionDenied(false);
                setAlarmPermissionDenied(false);

                const postRequestCapability = await NativeAlarmManager.checkCapability();
                const postRequestAuthStatus = postRequestCapability.platformDetails?.alarmKitAuthStatus;
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Updated auth status after permission request:', postRequestAuthStatus);

                if (postRequestAuthStatus !== 'authorized') {
                  await saveAlarmPermissionDenied(true);
                  setAlarmPermissionDenied(true);
                  Alert.alert(
                    t('alertTitles.alarmPermissionRequired'),
                    getPermissionInstructions('alarm'),
                    [{ text: t('buttonText.ok') }]
                  );
                  resetForm();
                  return;
                }

                // Permission authorized, clear denial state
                await saveAlarmPermissionDenied(false);
                setAlarmPermissionDenied(false);

                authStatus = postRequestAuthStatus;
              } catch (permissionError) {
                logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to request alarm permission:', permissionError);
                const errorMsg = permissionError instanceof Error ? permissionError.message : String(permissionError);

                const errorCheckCapability = await NativeAlarmManager.checkCapability();
                const errorCheckAuthStatus = errorCheckCapability.platformDetails?.alarmKitAuthStatus;

                if (errorCheckAuthStatus === 'denied') {
                  await saveAlarmPermissionDenied(true);
                  setAlarmPermissionDenied(true);
                  Alert.alert(
                    t('alertTitles.alarmPermissionDenied'),
                    getPermissionInstructions('alarm'),
                    [{ text: t('buttonText.ok') }]
                  );
                  resetForm();
                  return;
                } else {
                  Alert.alert(
                    t('alertTitles.alarmPermissionError'),
                    t('alertMessages.alarmPermissionError', { error: errorMsg }),
                    [{ text: t('buttonText.ok') }]
                  );
                  resetForm();
                  return;
                }
              }
            } else if (authStatus === 'denied') {
              await saveAlarmPermissionDenied(true);
              setAlarmPermissionDenied(true);
              Alert.alert(
                'Alarm Permission Denied',
                getPermissionInstructions('alarm'),
                [{ text: 'OK' }]
              );
              resetForm();
              return;
            } else if (authStatus !== 'authorized') {
              Alert.alert(
                t('alertTitles.alarmPermissionRequired'),
                getPermissionInstructions('alarm'),
                [{ text: t('buttonText.ok') }]
              );
              resetForm();
              return;
            }

            // Permission authorized, clear denial state
            await saveAlarmPermissionDenied(false);
            setAlarmPermissionDenied(false);

            if (authStatus !== 'authorized') {
              logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm permission not authorized, cannot schedule');
              resetForm();
              return;
            }
          }

          const hour = dateWithoutSeconds.getHours();
          const minutes = dateWithoutSeconds.getMinutes();
          const dayOfWeek = dateWithoutSeconds.getDay();
          const dayOfMonth = dateWithoutSeconds.getDate();
          const monthOfYear = dateWithoutSeconds.getMonth() + 1; // JavaScript months are 0-11

          // Remove the "thenotifier-" prefix from the notificationId to get the alarmId
          // because AlarmKit expects the alarm ID to be a UUID
          const alarmId = notificationId.substring("thenotifier-".length);
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Scheduling alarm with ID:', alarmId);
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm date:', dateWithoutSeconds.toISOString());

          // Handle daily alarms differently - schedule 7 fixed alarms
          if (repeatOption === 'daily') {
            // Schedule 7-day rolling window for daily alarms (AlarmKit alarms, not notifications)
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[AlarmWindow] Scheduling 7-day AlarmKit alarm window for daily repeat');
            await scheduleDailyAlarmWindow(
              notificationId,
              dateWithoutSeconds,
              { hour, minute: minutes },
              {
                title: notificationTitle,
                body: message,
                sound: Platform.OS === 'android' ? 'thenotifier' : undefined,
                color: '#8ddaff',
                data: {
                  notificationId: notificationId,
                  title: notificationTitle,
                  message: message,
                  note: note,
                  link: link ? link : '',
                  url: deepLinkUrl,
                },
                actions: ALARM_ACTIONS
              },
              7
            );
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[AlarmWindow] Scheduled 7 AlarmKit alarm instances for:', notificationId);
          } else {
            // Build alarm schedule for one-time or weekly alarms
            let alarmSchedule: any;

            if (repeatOption === 'none') {
              // One-time alarm
              alarmSchedule = {
                id: alarmId,
                type: 'fixed',
                date: dateWithoutSeconds.getTime(), // Pass milliseconds timestamp
                time: {
                  hour: hour,
                  minute: minutes,
                },
              };
            } else {
              // Recurring alarm (weekly, monthly, yearly)
              alarmSchedule = {
                id: alarmId,
                type: 'recurring',
                repeatInterval: repeatOption,
                startDate: dateWithoutSeconds.getTime(), // Pass milliseconds timestamp
                time: {
                  hour: hour,
                  minute: minutes,
                },
              };

              // Add repeat-specific fields
              if (repeatOption === 'weekly') {
                // AlarmKit uses JS weekday format (0-6, Sunday=0) based on code patterns
                // Keep using dayOfWeek (JS format) for AlarmKit
                alarmSchedule.daysOfWeek = [dayOfWeek];
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[AlarmSchedule] Weekly alarm - JS weekday:', dayOfWeek, 'AlarmKit daysOfWeek:', [dayOfWeek]);
              } else if (repeatOption === 'monthly') {
                alarmSchedule.dayOfMonth = dayOfMonth;
              } else if (repeatOption === 'yearly') {
                alarmSchedule.monthOfYear = monthOfYear;
                alarmSchedule.dayOfMonth = dayOfMonth;
              }
            }

            const alarmResult = await NativeAlarmManager.scheduleAlarm(
              alarmSchedule,
              {
                title: notificationTitle,
                body: message,
                sound: Platform.OS === 'android' ? 'thenotifier' : undefined,
                color: '#8ddaff',
                ...(Platform.OS === 'android' ? { category: notificationId } : {}),
                data: {
                  notificationId: notificationId,
                  title: notificationTitle,
                  message: message,
                  note: note,
                  link: link ? link : '',
                  url: deepLinkUrl,
                },
                actions: ALARM_ACTIONS
              },
            );

            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm scheduled successfully for:', dateWithoutSeconds);
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm result:', alarmResult);
            setTimeout(async () => {
              const existingAlarm = await NativeAlarmManager.getAlarm(alarmId);
              if (existingAlarm) {
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Scheduled existing alarm found in NativeAlarmManager:', alarmId);
              } else {
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Scheduled alarm not found in NativeAlarmManager:', alarmId);
              }
            }, 500);
          }

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          const errorDetails = {
            message: errorMessage,
            stack: errorStack,
            error: error,
            name: error instanceof Error ? error.name : typeof error,
          };

          logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to schedule alarm - error details:', errorDetails);
          logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to schedule alarm - error message:', errorMessage);

          if (errorMessage.includes('permission') || errorMessage.includes('Permission') || errorMessage.includes('authorization')) {
            await saveAlarmPermissionDenied(true);
            setAlarmPermissionDenied(true);
            Alert.alert(
              'Alarm Permission Required',
              getPermissionInstructions('alarm'),
              [{ text: 'OK' }]
            );
          } else {
            Alert.alert(t('alertTitles.warning'), t('alertMessages.alarmSchedulingWarning', { error: errorMessage }));
          }
        }
      }

      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Notification scheduled with ID:', notificationId);
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Notification selected date:', dateWithoutSeconds);
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Notification title:', notificationTitle);
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Notification message:', message);
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Notification note:', note);
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Notification link:', link);

      // Show warning alerts for rolling-window notifications (only when using rolling-window strategy)
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Checking alert display:', {
        useRollingWindow: useRollingWindow,
        repeatOption: repeatOption,
        shouldShowAlert: useRollingWindow && repeatOption !== 'none',
      });

      if (useRollingWindow && repeatOption !== 'none') {
        let alertTitle = '';
        let alertMessage = '';

        switch (repeatOption) {
          case 'daily':
            alertTitle = t('alertTitles.dailyAlarm');
            alertMessage = t('alertMessages.dailyAlarmMessage');
            break;
          case 'weekly':
            alertTitle = t('alertTitles.weeklyNotification');
            alertMessage = t('alertMessages.weeklyNotificationMessage');
            break;
          case 'monthly':
            alertTitle = t('alertTitles.monthlyNotification');
            alertMessage = t('alertMessages.monthlyNotificationMessage');
            break;
          case 'yearly':
            alertTitle = t('alertTitles.yearlyNotification');
            alertMessage = t('alertMessages.yearlyNotificationMessage');
            break;
        }

        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Showing alert:', {
          alertTitle: alertTitle,
          repeatOption: repeatOption,
        });

        Alert.alert(
          alertTitle,
          alertMessage,
          [
            {
              text: t('buttonText.ok'),
              onPress: async () => {
                try {
                  await resetForm();
                } catch (resetError) {
                  logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Error in resetForm (from alert):', resetError);
                  // Continue anyway - form reset is not critical
                }
                onSuccess?.();
              },
            },
          ]
        );
      } else {
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] No alert shown (not rolling-window or one-time)');
        try {
          await resetForm();
        } catch (resetError) {
          logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Error in resetForm:', resetError);
          // Continue anyway - form reset is not critical
        }
        onSuccess?.();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorDetails = {
        message: errorMessage,
        stack: errorStack,
        error: error,
        name: error instanceof Error ? error.name : typeof error,
      };

      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Error details:', errorDetails);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to schedule notification with ID:', notificationId);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed selected date:', dateWithoutSeconds);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed title:', notificationTitle);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed message:', message);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed note:', note);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed link:', link);

      if (isEditMode) {
        Alert.alert(t('alertTitles.error'), t('alertMessages.failedToUpdateGeneric'));
      } else {
        Alert.alert(t('alertTitles.error'), t('alertMessages.failedToSchedule'));
      }
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
      try {
        await archiveScheduledNotifications();
      } catch (error) {
        // Error already logged in archiveScheduledNotifications, just prevent uncaught rejection
        logger.error(makeLogHeader(LOG_FILE), 'Failed to archive notifications in useEffect:', error);
      }
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
                <ThemedText maxFontSizeMultiplier={1.2} style={clearButtonTextStyle}>{source === 'home' || source === 'calendar' ? t('buttonText.cancel') : t('buttonText.clear')}</ThemedText>
              </TouchableOpacity>
            </ThemedView>

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>{t('inputLabels.dateAndTime')}</ThemedText>
              <TouchableOpacity
                style={dateButtonStyle}
                onPress={handleDateButtonPress}>
                <ThemedText maxFontSizeMultiplier={1.6}>{formatDateTime(selectedDate)}</ThemedText>
              </TouchableOpacity>
            </ThemedView>

            {showDatePicker && Platform.OS === 'ios' && (
              <ThemedView style={pickerContainerStyle}>
                <DateTimePicker
                  value={selectedDate}
                  mode="datetime"
                  display="spinner"
                  onChange={handleDateChange}
                  minimumDate={minimumDate}
                  textColor={colors.text}
                  themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
                  accentColor={colors.tint}
                />
              </ThemedView>
            )}
            {Platform.OS === 'ios' && showDatePicker && (
              <TouchableOpacity
                style={doneButtonStyle}
                onPress={handleDonePress}>
                <ThemedText maxFontSizeMultiplier={1.6} style={doneButtonTextStyle}>{t('buttonText.done')}</ThemedText>
              </TouchableOpacity>
            )}

            {/* Android: Always visible picker */}
            {Platform.OS === 'android' && (() => {
              // Calculate font size respecting maxFontSizeMultiplier of 1.6
              // Picker respects system font scaling, so we need to account for that
              const baseFontSize = 18; // Match ThemedText default fontSize
              const fontScale = PixelRatio.getFontScale();
              const maxMultiplier = 1.6;
              // Calculate desired final size, then divide by fontScale to account for Picker's scaling
              const desiredFinalSize = baseFontSize * Math.min(fontScale, maxMultiplier);
              const calculatedFontSize = desiredFinalSize / fontScale;

              return (
                <ThemedView style={styles.inputGroup}>
                  <ThemedText style={{ fontSize: baseFontSize }} maxFontSizeMultiplier={1.6}>{t('inputLabels.repeat')}</ThemedText>
                  <ThemedView style={[pickerContainerStyle, { paddingTop: 0, paddingBottom: 0, paddingHorizontal: 8 }]}>
                    <Picker
                      selectedValue={repeatOption}
                      onValueChange={handleRepeatChange}
                      style={[styles.picker, { color: colors.text, fontSize: calculatedFontSize, paddingLeft: 4 }]}
                      itemStyle={{ color: colors.text, fontSize: calculatedFontSize }}
                    >
                      <Picker.Item label={t('repeatOptions.doNotRepeat')} value="none" />
                      <Picker.Item label={t('repeatOptions.repeatEveryDay')} value="daily" />
                      <Picker.Item label={t('repeatOptions.repeatEveryWeek')} value="weekly" />
                      <Picker.Item label={t('repeatOptions.repeatEveryMonth')} value="monthly" />
                      <Picker.Item label={t('repeatOptions.repeatEveryYear')} value="yearly" />
                    </Picker>
                  </ThemedView>
                </ThemedView>
              );
            })()}

            {/* iOS: Button + conditional picker */}
            {Platform.OS === 'ios' && (
              <>
                <ThemedView style={styles.inputGroup}>
                  <TouchableOpacity
                    style={repeatButtonStyle}
                    onPress={handleRepeatButtonPress}>
                    <ThemedText maxFontSizeMultiplier={1.6}>{formatRepeatOption(repeatOption)}</ThemedText>
                  </TouchableOpacity>
                </ThemedView>

                {
                  showRepeatPicker && (
                    <ThemedView style={pickerContainerStyle}>
                      <Picker
                        selectedValue={repeatOption}
                        onValueChange={handleRepeatChange}
                        style={[styles.picker, { color: colors.text }]}
                        itemStyle={{ color: colors.text }}
                      >
                        <Picker.Item label={t('repeatOptions.doNotRepeat')} value="none" />
                        <Picker.Item label={t('repeatOptions.repeatEveryDay')} value="daily" />
                        <Picker.Item label={t('repeatOptions.repeatEveryWeek')} value="weekly" />
                        <Picker.Item label={t('repeatOptions.repeatEveryMonth')} value="monthly" />
                        <Picker.Item label={t('repeatOptions.repeatEveryYear')} value="yearly" />
                      </Picker>
                    </ThemedView>
                  )
                }
                {
                  showRepeatPicker && (
                    <TouchableOpacity
                      style={doneButtonStyle}
                      onPress={handleRepeatDonePress}>
                      <ThemedText maxFontSizeMultiplier={1.6} style={doneButtonTextStyle}>{t('buttonText.done')}</ThemedText>
                    </TouchableOpacity >
                  )
                }
              </>
            )}

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>{t('inputLabels.message')}</ThemedText>
              <TextInput
                ref={messageInputRef}
                style={inputStyle}
                placeholder={t('inputPlaceholders.notificationMessage')}
                placeholderTextColor={colors.placeholderText}
                value={message}
                onChangeText={handleMessageChange}
                onFocus={handleMessageFocus}
                // multiline
                // numberOfLines={1}
                maxFontSizeMultiplier={1.6}
              />
            </ThemedView >

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>{t('inputLabels.noteOptional')}</ThemedText>
              <TextInput
                ref={noteInputRef}
                style={textAreaStyle}
                placeholder={t('inputPlaceholders.shortNote')}
                placeholderTextColor={colors.placeholderText}
                value={note}
                onChangeText={handleNoteChange}
                onFocus={handleNoteFocus}
                multiline
                numberOfLines={6}
                maxFontSizeMultiplier={1.6}
              />
            </ThemedView >

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>{t('inputLabels.linkOptional')}</ThemedText>
              <TextInput
                ref={linkInputRef}
                style={inputStyle}
                placeholder={t('inputPlaceholders.linkToOpen')}
                placeholderTextColor={colors.placeholderText}
                value={link}
                onChangeText={handleLinkChange}
                onFocus={handleLinkFocus}
                onBlur={handleLinkBlur}
                maxFontSizeMultiplier={1.6}

              />
            </ThemedView >

            {alarmSupported && (
              <ThemedView style={styles.inputGroup}>
                <ThemedView style={styles.switchContainer}>
                  <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>{t('inputLabels.alarm')}</ThemedText>
                  <Switch
                    value={scheduleAlarm}
                    onValueChange={handleAlarmSwitchChange}
                    trackColor={{ false: '#888', true: '#68CFAF' }}
                    thumbColor='#f0f0f0'
                  />
                </ThemedView>
              </ThemedView >
            )}

            <TouchableOpacity
              ref={scheduleButtonRef}
              style={scheduleButtonStyle}
              onPress={scheduleNotification}
              onLayout={handleButtonLayout}>
              <ThemedText
                maxFontSizeMultiplier={1.6}
                style={scheduleButtonTextStyle}>
                {isEditMode ? t('buttonText.updateNotification') : t('buttonText.scheduleNotification')}
              </ThemedText>
            </TouchableOpacity >
          </ThemedView >

        </TouchableWithoutFeedback >
      </KeyboardAwareScrollView >
      <KeyboardToolbar
        opacity="CF"
        offset={{
          opened: Platform.OS === 'android'
            ? (() => {
              // Adjust offset based on navigation mode and source
              // Button navigation: toolbar needs to move down ~25px, so increase offset by 25px
              // Gesture navigation: toolbar needs to move higher, so reduce offset by 15px (move up)
              const baseOffset = (source === 'tab' || source === 'schedule') ? 95 : 10;
              if (isButtonNavigation) {
                // Button navigation: move toolbar down by increasing offset
                return baseOffset + 20;
              } else {
                // Gesture navigation: move toolbar up more by reducing offset further
                return baseOffset - 15;
              }
            })()
            : ((source === 'tab' || source === 'schedule') ? 95 : 15),
          closed: 0
        }}
        theme={theme}
        showArrows={true}
        doneText="Done"
      />
    </ThemedView >
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
  keyboardToolbarButton: {
    fontSize: 18,
  },
  pickerContainer: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 50,
    marginTop: 6,
  },
  picker: {
    minHeight: 50,
  },
});

