import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, Keyboard, Platform, ScrollView, StyleSheet, Switch, TextInput, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { NativeAlarmManager } from 'rn-native-alarmkit';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { archiveScheduledNotifications, saveScheduledNotificationData } from '@/utils/database';
import * as Crypto from 'expo-crypto';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';


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


export default function NotificationScreen() {
  const params = useLocalSearchParams<{
    date?: string;
    title?: string;
    message?: string;
    note?: string;
    link?: string;
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
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const scrollViewRef = useRef<ScrollView>(null);
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
  }, [params.date, params.title, params.message, params.note, params.link]);

  // Helper function to scroll to show the button above keyboard
  const scrollToShowButton = (keyboardHeight: number) => {
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
  };

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
  }, []);

  const resetForm = () => {
    setMessage('');
    setNote('');
    setLink('');
    setTitle('');
    setSelectedDate(new Date());
    setScheduleAlarm(false);
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
      const deepLinkUrl = `thenotifier://notification?message=${encodeURIComponent(message)}&link=${encodeURIComponent(link || '')}`;
      console.log('deepLinkUrl:', deepLinkUrl);

      console.log('=== SCHEDULE NOTIFICATION ASYNC ===');

      let notificationContent: Notifications.NotificationContentInput = {
        title: title,
        body: message,
        data: {
          title: title,
          message: message,
          note: note,
          link: link ? link : '',
          url: deepLinkUrl
        },
        vibrate: [0, 1000, 500, 1000],
        sound: 'thenotifier.wav'
      };
      if (Platform.OS === 'ios') {
        notificationContent.interruptionLevel = 'timeSensitive';
      }

      await Notifications.scheduleNotificationAsync({
        identifier: notificationId,
        content: notificationContent,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: dateWithoutSeconds,
          channelId: "thenotifier"
        },
      });

      await saveScheduledNotificationData(notificationId, title, message, note, link ? link : '', dateWithoutSeconds.toISOString(), dateWithoutSeconds.toLocaleString());
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
      console.log('Notification title:', title);
      console.log('Notification message:', message);
      console.log('Notification note:', note);
      console.log('Notification link:', link);
    } catch (error) {
      Alert.alert('Error', 'Failed to schedule notification');
      console.error(error);
      console.error('Failed to schedule notification with ID:', notificationId);
      console.error('Failed selected date:', dateWithoutSeconds);
      console.error('Failed title:', title);
      console.error('Failed message:', message);
      console.error('Failed note:', note);
      console.error('Failed link:', link);
    }
    resetForm();
  };

  const formatDateTime = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  useEffect(() => {
    // Check if we need to archive any scheduled notifications
    (async () => {
      await archiveScheduledNotifications();
    })();
  }, []);

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        bottomOffset={4}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}>
            <ThemedView style={styles.header}>
              <ThemedText type="title">Schedule Notification</ThemedText>
            </ThemedView>

            <ThemedView
              style={styles.form}
              onLayout={(event) => {
                // Track form's top position in ScrollView content
                // onLayout gives position relative to ScrollView content (which includes padding)
                const { y } = event.nativeEvent.layout;
                formTopInContent.current = y;
              }}>
              <ThemedView style={styles.inputGroup}>
                <ThemedText type="subtitle">Date & Time</ThemedText>
                <TouchableOpacity
                  style={[styles.dateButton, { borderColor: colors.icon, backgroundColor: colors.background }]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setShowDatePicker(true);
                  }}>
                  <ThemedText>{formatDateTime(selectedDate)}</ThemedText>
                </TouchableOpacity>
              </ThemedView>

              {showDatePicker && (
                <DateTimePicker
                  value={selectedDate}
                  mode="datetime"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, date) => {
                    if (Platform.OS === 'android') {
                      setShowDatePicker(false);
                    }
                    if (event.type === 'set' && date) {
                      setSelectedDate(date);
                    }
                    if (Platform.OS === 'android' && event.type === 'dismissed') {
                      setShowDatePicker(false);
                    }
                  }}
                  minimumDate={new Date()}
                />
              )}
              {Platform.OS === 'ios' && showDatePicker && (
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: colors.tint, marginTop: 10 }]}
                  onPress={() => setShowDatePicker(false)}>
                  <ThemedText style={styles.buttonText}>Done</ThemedText>
                </TouchableOpacity>
              )}

              <ThemedView style={styles.inputGroup}>
                <ThemedText type="subtitle">Message</ThemedText>
                <TextInput
                  ref={messageInputRef}
                  style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
                  placeholder="Notification message"
                  placeholderTextColor={colors.icon}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={2}
                />
              </ThemedView>

              <ThemedView style={styles.inputGroup}>
                <ThemedText type="subtitle">Note (optional)</ThemedText>
                <TextInput
                  ref={noteInputRef}
                  style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.icon }]}
                  placeholder="A short note"
                  placeholderTextColor={colors.icon}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  numberOfLines={6}
                />
              </ThemedView>

              <ThemedView style={styles.inputGroup}>
                <ThemedText type="subtitle">Link (optional)</ThemedText>
                <TextInput
                  ref={linkInputRef}
                  style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
                  placeholder="Link to open for this notification"
                  placeholderTextColor={colors.icon}
                  value={link}
                  onChangeText={setLink}
                  onFocus={() => {
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
                  }}
                  onBlur={() => {
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
                  }}
                />
              </ThemedView>

              {alarmSupported && (
                <ThemedView style={styles.inputGroup}>
                  <ThemedView style={styles.switchContainer}>
                    <ThemedText type="subtitle">Create Alarm</ThemedText>
                    <Switch
                      value={scheduleAlarm}
                      onValueChange={setScheduleAlarm}
                      trackColor={{ false: '#888', true: '#499f5d' }}
                      thumbColor={Platform.OS === 'ios' ? '#499f5d' : colors.background}
                    />
                  </ThemedView>
                  {/* <ThemedText style={[styles.switchDescription, { color: colors.icon }]}>
                    Schedule a system alarm.
                  </ThemedText> */}
                </ThemedView>
              )}

              <TouchableOpacity
                ref={scheduleButtonRef}
                style={[styles.button, { backgroundColor: colors.tint }]}
                onPress={scheduleNotification}
                onLayout={(event) => {
                  // Track button's bottom position relative to form top
                  const { y, height } = event.nativeEvent.layout;
                  buttonBottomInForm.current = y + height;
                }}>
                <ThemedText style={styles.buttonText}>Schedule Notification</ThemedText>
              </TouchableOpacity>
            </ThemedView>

            {/* Spacer view to ensure link input has space above keyboard */}
            {/* <ThemedView style={{ height: 300 }} /> */}
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAwareScrollView>
      <KeyboardToolbar offset={{ opened: 94, closed: 0 }} />
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
    padding: 20,
    // paddingBottom: 400, // Extra padding to ensure link input has space above keyboard
  },
  header: {
    marginBottom: 30,
    marginTop: 60,
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
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#605678',
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
});