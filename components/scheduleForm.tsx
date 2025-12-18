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
import { archiveScheduledNotifications, deleteScheduledNotification, getAlarmPermissionDenied, getAllActiveDailyAlarmInstances, getAllActiveRepeatNotificationInstances, getWindowSize, markAllDailyAlarmInstancesCancelled, markAllRepeatNotificationInstancesCancelled, saveAlarmPermissionDenied, saveScheduledNotificationData, scheduleDailyAlarmWindow, scheduleRollingWindowNotifications } from '@/utils/database';
import { logger, makeLogHeader } from '@/utils/logger';
import { getPermissionInstructions } from '@/utils/permissions';
import * as Crypto from 'expo-crypto';
import { DefaultKeyboardToolbarTheme, KeyboardAwareScrollView, KeyboardToolbar, KeyboardToolbarProps } from 'react-native-keyboard-controller';

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
    primary: "#8ddaff",
    background: "#1d1d1d",
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
                  'Alarm Permission Required',
                  'The alarm will be removed from this upcoming notification because this app no longer has permission to set alarms.'
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
          'Maximum Notifications Reached',
          `Uh oh, you've reached the maximum of ${MAX_SCHEDULED_NOTIFICATION_COUNT} scheduled notifications. You can delete an upcoming notification if you need to schedule a new notification.`,
          [{ text: 'OK' }]
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
            'Alarm Permission Required',
            getPermissionInstructions('alarm'),
            [{ text: 'OK' }]
          );
          // Don't change the switch value
          return;
        } else if (capability.requiresPermission && authStatus === 'notDetermined' && capability.canRequestPermission) {
          // Try to request permission
          try {
            const granted = await NativeAlarmManager.requestPermission();
            if (!granted) {
              Alert.alert(
                'Alarm Permission Required',
                getPermissionInstructions('alarm'),
                [{ text: 'OK' }]
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
                'Alarm Permission Required',
                getPermissionInstructions('alarm'),
                [{ text: 'OK' }]
              );
              await saveAlarmPermissionDenied(true);
              setAlarmPermissionDenied(true);
              return;
            }
          }
        } else if (capability.requiresPermission && authStatus !== 'authorized') {
          // Not authorized, show alert
          Alert.alert(
            'Alarm Permission Required',
            getPermissionInstructions('alarm'),
            [{ text: 'OK' }]
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
    let shouldEnableAlarm = false;
    if (!isEditMode && (source === 'tab' || source === 'calendar' || source === 'schedule')) {
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
    logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '=== SCHEDULE NOTIFICATION ===');

    // Check notification permissions first
    try {
      const notificationPermissions = await Notifications.getPermissionsAsync();
      if (notificationPermissions.status !== 'granted') {
        Alert.alert(
          'Notification Permission Required',
          'This app will not work until notifications are enabled.\n\n' + getPermissionInstructions('notification'),
          [{ text: 'OK' }]
        );
        return;
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to check notification permissions:', error);
      Alert.alert(
        'Notification Permission Required',
        'This app will not work until notifications are enabled.\n\n' + getPermissionInstructions('notification'),
        [{ text: 'OK' }]
      );
      return;
    }

    if (!message.trim()) {
      Alert.alert('Error', 'You forgot the message');
      return;
    }

    logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Selected date:', selectedDate);

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
        // Check if this is a rolling-window managed notification
        const { getAllScheduledNotificationData } = await import('@/utils/database');
        const allNotifications = await getAllScheduledNotificationData();
        const existingNotification = allNotifications.find(n => n.notificationId === editingNotificationId);
        const isRollingWindow = existingNotification?.notificationTrigger && (existingNotification.notificationTrigger as any).type === 'DATE_WINDOW';

        if (isRollingWindow) {
          // Cancel all rolling-window notification instances
          const repeatInstances = await getAllActiveRepeatNotificationInstances(editingNotificationId);
          for (const instance of repeatInstances) {
            try {
              await Notifications.cancelScheduledNotificationAsync(instance.instanceNotificationId);
              logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Cancelled rolling-window notification instance on edit:', instance.instanceNotificationId);
            } catch (instanceError) {
              logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to cancel rolling-window notification instance:', instance.instanceNotificationId, ', error:', instanceError);
            }
          }
          await markAllRepeatNotificationInstancesCancelled(editingNotificationId);
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Marked all rolling-window notification instances as cancelled on edit');
        } else {
          // Cancel the single scheduled notification
          await Notifications.cancelScheduledNotificationAsync(editingNotificationId);
          logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Cancelled existing notification:', editingNotificationId);
        }

        const alarmId = editingNotificationId.substring("thenotifier-".length);
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Cancelling existing alarm with ID:', alarmId);
        if (editingHasAlarm) {
          try {
            // Check if this is a daily repeating alarm - if so, cancel all instances
            if (existingNotification?.repeatOption === 'daily') {
              // Cancel all daily alarm instances
              const dailyInstances = await getAllActiveDailyAlarmInstances(editingNotificationId);
              for (const instance of dailyInstances) {
                try {
                  await NativeAlarmManager.cancelAlarm(instance.alarmId);
                  logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Cancelled daily alarm instance:', instance.alarmId);
                } catch (instanceError) {
                  const errorMessage = instanceError instanceof Error ? instanceError.message : String(instanceError);
                  if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
                    logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to cancel daily alarm instance:', instance.alarmId, ', error:', instanceError);
                  }
                }
              }
              await markAllDailyAlarmInstancesCancelled(editingNotificationId);
              logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Marked all daily alarm instances as cancelled');
            } else {
              // Single alarm (one-time or weekly)
              const existingAlarm = await NativeAlarmManager.getAlarm(alarmId);
              if (existingAlarm) {
                await NativeAlarmManager.cancelAlarm(alarmId);
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Cancelled existing alarm:', alarmId);
              } else {
                logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm not found, may have already been cancelled:', alarmId);
              }
            }
          } catch (alarmError) {
            const errorMessage = alarmError instanceof Error ? alarmError.message : String(alarmError);
            if (errorMessage.includes('not found') || errorMessage.includes('ALARM_NOT_FOUND')) {
              logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Alarm not found (may have already been cancelled):', alarmId);
            } else {
              logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to cancel existing alarm:', alarmId, ', error:', alarmError);
            }
          }
        }

        await deleteScheduledNotification(editingNotificationId);
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Deleted existing notification from DB:', editingNotificationId);
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to cancel/delete existing notification:', error);
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

      let notificationTrigger: Notifications.NotificationTriggerInput;
      let useRollingWindow = false;
      const hour = dateWithoutSeconds.getHours();
      const minute = dateWithoutSeconds.getMinutes();
      const day = dateWithoutSeconds.getDate();
      const dayOfWeek = dateWithoutSeconds.getDay();
      const month = dateWithoutSeconds.getMonth();

      const now = new Date();
      const nowMs = now.getTime();
      const selectedMs = dateWithoutSeconds.getTime();
      const diffMs = selectedMs - nowMs;
      const diffHours = diffMs / (60 * 60 * 1000);
      const diffDays = diffMs / (24 * 60 * 60 * 1000);

      // Thresholds in milliseconds
      const oneDayMs = 24 * 60 * 60 * 1000;
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

      // Calendar-based thresholds for monthly/yearly
      const oneMonthFromNow = new Date(now);
      oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
      const oneYearFromNow = new Date(now);
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      // Log decision inputs
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Decision inputs:', {
        nowISO: now.toISOString(),
        selectedISO: dateWithoutSeconds.toISOString(),
        diffMs: diffMs,
        diffHours: diffHours.toFixed(2),
        diffDays: diffDays.toFixed(2),
        repeatOption: repeatOption,
        oneDayThresholdMs: oneDayMs,
        oneWeekThresholdMs: oneWeekMs,
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
          // Use milliseconds-based comparison for daily
          if (diffMs >= oneDayMs) {
            // Use rolling window
            useRollingWindow = true;
            notificationTrigger = {
              type: 'DATE_WINDOW' as any,
              window: 'daily14',
            } as any;
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Daily repeat: using rollingWindow (diffMs >= 24h)', {
              diffMs: diffMs,
              thresholdMs: oneDayMs,
              windowSize: 14,
            });
          } else {
            // Use existing DAILY trigger
            notificationTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: hour,
              minute: minute,
            };
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Daily repeat: using Expo DAILY trigger (diffMs < 24h)', {
              diffMs: diffMs,
              thresholdMs: oneDayMs,
            });
          }
          break;
        case 'weekly':
          // Use milliseconds-based comparison for weekly
          if (diffMs >= oneWeekMs) {
            // Use rolling window
            useRollingWindow = true;
            notificationTrigger = {
              type: 'DATE_WINDOW' as any,
              window: 'weekly4',
            } as any;
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Weekly repeat: using rollingWindow (diffMs >= 7d)', {
              diffMs: diffMs,
              thresholdMs: oneWeekMs,
              windowSize: 4,
            });
          } else {
            // Use existing WEEKLY trigger
            notificationTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: dayOfWeek,
              hour: hour,
              minute: minute,
            };
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Weekly repeat: using Expo WEEKLY trigger (diffMs < 7d)', {
              diffMs: diffMs,
              thresholdMs: oneWeekMs,
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
            // Use existing YEARLY trigger
            notificationTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.YEARLY,
              month: month,
              day: day,
              hour: hour,
              minute: minute,
            };
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Yearly repeat: using Expo YEARLY trigger (selected < oneYearFromNow)', {
              selectedISO: dateWithoutSeconds.toISOString(),
              oneYearFromNowISO: oneYearFromNow.toISOString(),
            });
          }
          break;
      }

      // Log final decision
      logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] Final decision:', {
        useRollingWindow: useRollingWindow,
        notificationTriggerType: (notificationTrigger as any).type,
        repeatOption: repeatOption,
      });

      if (useRollingWindow) {
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
            'Maximum Notifications Reached',
            `Your phone limits the number of notifications that can be scheduled. To schedule this, you will need to delete ${neededToDelete} notifications.`,
            [{ text: 'OK' }]
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
          (notificationTrigger as any).channelId = "thenotifier";
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
      if (isEditMode && !scheduleAlarm && editingHasAlarm) {
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
                    'Alarm Permission Denied',
                    getPermissionInstructions('alarm'),
                    [{ text: 'OK' }]
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
                    'Alarm Permission Required',
                    getPermissionInstructions('alarm'),
                    [{ text: 'OK' }]
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
                    'Alarm Permission Denied',
                    getPermissionInstructions('alarm'),
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
                'Alarm Permission Required',
                getPermissionInstructions('alarm'),
                [{ text: 'OK' }]
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

          // Handle daily alarms differently - schedule 14 fixed alarms
          if (repeatOption === 'daily') {
            // Schedule 14-day rolling window for daily alarms (AlarmKit alarms, not notifications)
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[AlarmWindow] Scheduling 14-day AlarmKit alarm window for daily repeat');
            await scheduleDailyAlarmWindow(
              notificationId,
              dateWithoutSeconds,
              { hour, minute: minutes },
              {
                title: message,
                color: '#8ddaff',
                data: {
                  notificationId: notificationId,
                },
                actions: ALARM_ACTIONS
              },
              14
            );
            logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[AlarmWindow] Scheduled 14 AlarmKit alarm instances for:', notificationId);
          } else {
            // Build alarm schedule for one-time or weekly alarms
            let alarmSchedule: any;

            if (repeatOption === 'none') {
              // One-time alarm
              alarmSchedule = {
                id: alarmId,
                type: 'fixed',
                date: dateWithoutSeconds,
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
                startDate: dateWithoutSeconds,
                time: {
                  hour: hour,
                  minute: minutes,
                },
              };

              // Add repeat-specific fields
              if (repeatOption === 'weekly') {
                alarmSchedule.daysOfWeek = [dayOfWeek];
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
                title: message,
                color: '#8ddaff',
                data: {
                  notificationId: notificationId,
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
          logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to schedule alarm:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('permission') || errorMessage.includes('Permission') || errorMessage.includes('authorization')) {
            await saveAlarmPermissionDenied(true);
            setAlarmPermissionDenied(true);
            Alert.alert(
              'Alarm Permission Required',
              getPermissionInstructions('alarm'),
              [{ text: 'OK' }]
            );
          } else {
            Alert.alert('Warning', `The notification was scheduled, but there was a problem scheduling the alarm: ${errorMessage}`);
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
            alertTitle = 'Daily Alarm';
            alertMessage = "To prevent your phone from stopping this daily alarm, you may need to use this app at least once every two week period after the start date.";
            break;
          case 'weekly':
            alertTitle = 'Weekly Notification';
            alertMessage = "To prevent your phone from stopping this weekly notification, you may need to use use this app at least once a month after the start date.";
            break;
          case 'monthly':
            alertTitle = 'Monthly Notification';
            alertMessage = "To prevent your phone from stopping this monthly notification, you may need to use use this app at least once a month after the start date.";
            break;
          case 'yearly':
            alertTitle = 'Yearly Notification';
            alertMessage = "To prevent your phone from stopping this yearly notification, you may need to use use this app at least once a year after the start date.";
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
              text: 'OK',
              onPress: () => {
                resetForm();
                onSuccess?.();
              },
            },
          ]
        );
      } else {
        logger.info(makeLogHeader(LOG_FILE, 'scheduleNotification'), '[RepeatDecision] No alert shown (not rolling-window or one-time)');
        resetForm();
        onSuccess?.();
      }
    } catch (error) {
      if (isEditMode) {
        Alert.alert('Error', 'Sorry, your notification could not be updated.');
      } else {
        Alert.alert('Error', 'Sorry, your notification could not be scheduled.');
      }
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), error);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed to schedule notification with ID:', notificationId);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed selected date:', dateWithoutSeconds);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed title:', notificationTitle);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed message:', message);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed note:', note);
      logger.error(makeLogHeader(LOG_FILE, 'scheduleNotification'), 'Failed link:', link);
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
                <ThemedText maxFontSizeMultiplier={1.2} style={clearButtonTextStyle}>{source === 'home' || source === 'calendar' ? 'Cancel' : 'Clear'}</ThemedText>
              </TouchableOpacity>
            </ThemedView>

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>Date & Time</ThemedText>
              <TouchableOpacity
                style={dateButtonStyle}
                onPress={handleDateButtonPress}>
                <ThemedText maxFontSizeMultiplier={1.6}>{formatDateTime(selectedDate)}</ThemedText>
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
                <ThemedText maxFontSizeMultiplier={1.6} style={doneButtonTextStyle}>Done</ThemedText>
              </TouchableOpacity>
            )}

            <ThemedView style={styles.inputGroup}>
              <TouchableOpacity
                style={repeatButtonStyle}
                onPress={handleRepeatButtonPress}>
                <ThemedText maxFontSizeMultiplier={1.6}>{formatRepeatOption(repeatOption)}</ThemedText>
              </TouchableOpacity>
            </ThemedView>

            {
              showRepeatPicker && (
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
              )
            }
            {
              Platform.OS === 'ios' && showRepeatPicker && (
                <TouchableOpacity
                  style={doneButtonStyle}
                  onPress={handleRepeatDonePress}>
                  <ThemedText maxFontSizeMultiplier={1.6} style={doneButtonTextStyle}>Done</ThemedText>
                </TouchableOpacity >
              )
            }

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>Message</ThemedText>
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
                maxFontSizeMultiplier={1.6}
              />
            </ThemedView >

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>Note (optional)</ThemedText>
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
                maxFontSizeMultiplier={1.6}
              />
            </ThemedView >

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>Link (optional)</ThemedText>
              <TextInput
                ref={linkInputRef}
                style={inputStyle}
                placeholder="Link to open for this notification"
                placeholderTextColor={colors.placeholderText}
                value={link}
                onChangeText={setLink}
                onFocus={handleLinkFocus}
                onBlur={handleLinkBlur}
                maxFontSizeMultiplier={1.6}

              />
            </ThemedView >

            {alarmSupported && (
              <ThemedView style={styles.inputGroup}>
                <ThemedView style={styles.switchContainer}>
                  <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>Alarm</ThemedText>
                  <Switch
                    value={scheduleAlarm}
                    onValueChange={handleAlarmSwitchChange}
                    trackColor={{ false: '#888', true: '#68CFAF' }}
                    thumbColor={Platform.OS === 'ios' ? '#f0f0f0' : colors.background}
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
                {isEditMode ? 'Update' : 'Schedule'} Notification
              </ThemedText>
            </TouchableOpacity >
          </ThemedView >

        </TouchableWithoutFeedback >
      </KeyboardAwareScrollView >
      <KeyboardToolbar
        opacity="CF"
        offset={{
          opened: (source === 'tab' || source === 'schedule') ? 95 : 15,
          closed: 0
        }}
        theme={theme}>
        <KeyboardToolbar.Prev />
        <KeyboardToolbar.Next />
        <KeyboardToolbar.Done />
      </KeyboardToolbar>
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
  picker: {
    padding: 12,
    minHeight: 50,
  },
});

