import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { archiveScheduledNotifications, saveScheduledNotificationData } from '@/utils/database';
import * as Crypto from 'expo-crypto';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function NotificationScreen() {
  const params = useLocalSearchParams<{
    date?: string;
    shortMessage?: string;
    longMessage?: string;
    link?: string;
  }>();

  // Initialize state from params if available
  const [shortMessage, setShortMessage] = useState(params.shortMessage || '');
  const [longMessage, setLongMessage] = useState(params.longMessage || '');
  const [selectedDate, setSelectedDate] = useState(
    params.date ? new Date(params.date) : new Date()
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [link, setLink] = useState(params.link || '');
  const scrollViewRef = useRef<ScrollView>(null);
  const linkInputRef = useRef<TextInput>(null);
  const scheduleButtonRef = useRef<any>(null);
  const formTopInContent = useRef<number>(0);
  const buttonBottomInForm = useRef<number>(0);
  const keyboardHeightRef = useRef<number>(0);
  const hasScrolledForFocus = useRef<boolean>(false);

  useEffect(() => {
    // Request permissions
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please enable notifications in your device settings.');
      }
    })();
  }, []);

  // Update fields when params change (e.g., when navigating from calendar)
  useEffect(() => {
    if (params.date) {
      setSelectedDate(new Date(params.date));
    }
    if (params.shortMessage) {
      setShortMessage(params.shortMessage);
    }
    if (params.longMessage) {
      setLongMessage(params.longMessage);
    }
    if (params.link) {
      setLink(params.link);
    }
  }, [params.date, params.shortMessage, params.longMessage, params.link]);

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

    // console.log('Scrolling to show button:', {
    //   formTopInContent: formTopInContent.current,
    //   buttonBottomInForm: buttonBottomInForm.current,
    //   buttonBottomInContent,
    //   visibleHeight,
    //   keyboardHeight,
    //   screenHeight,
    //   targetScrollY,
    // });

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

  const scheduleNotification = async () => {
    if (!shortMessage.trim() || !longMessage.trim()) {
      Alert.alert('Error', 'Please fill in both messages');
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
          sound: 'notifyme.wav', // Provide ONLY the base filename
        });
      }

      await Notifications.scheduleNotificationAsync({
        identifier: notificationId,
        content: {
          title: 'Notification',
          body: shortMessage,
          data: { message: longMessage, link: link ? link : '' },
          vibrate: [0, 1000, 500, 1000],
          sound: 'notifyme.wav'
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: dateWithoutSeconds,
          channelId: "thenotifier"
        },
      });

      await saveScheduledNotificationData(notificationId, 'Notification', shortMessage, longMessage, link ? link : '', dateWithoutSeconds.toISOString(), dateWithoutSeconds.toLocaleString());
      console.log('Notification data saved successfully');

      Alert.alert('Success', 'Notification scheduled successfully!');
      console.log('Notification scheduled with ID:', notificationId);
      console.log('Notification short message:', shortMessage);
      console.log('Notification long message:', longMessage);
      console.log('Notification link:', link);
      console.log('Notification selected date:', dateWithoutSeconds);
      setShortMessage('');
      setLongMessage('');
      setLink('');
      setSelectedDate(new Date());

    } catch (error) {
      Alert.alert('Error', 'Failed to schedule notification');
      console.error(error);
      console.error('Failed to schedule notification with ID:', notificationId);
      console.error('Failed short message:', shortMessage);
      console.error('Failed long message:', longMessage);
      console.error('Failed link:', link);
      console.error('Failed selected date:', dateWithoutSeconds);
    }
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 4 : 0}>
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
              <ThemedText type="subtitle">Short Message</ThemedText>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
                placeholder="Enter short notification message"
                placeholderTextColor={colors.icon}
                value={shortMessage}
                onChangeText={setShortMessage}
                multiline
                numberOfLines={2}
              />
            </ThemedView>

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle">Long Message</ThemedText>
              <TextInput
                style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.icon }]}
                placeholder="Enter detailed message to display when notification is opened"
                placeholderTextColor={colors.icon}
                value={longMessage}
                onChangeText={setLongMessage}
                multiline
                numberOfLines={6}
              />
            </ThemedView>

            <ThemedView style={styles.inputGroup}>
              <ThemedText type="subtitle">Link (optional)</ThemedText>
              <TextInput
                ref={linkInputRef}
                style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
                placeholder="Enter link to open when notification is tapped"
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
    </KeyboardAvoidingView>
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
    fontSize: 16,
    minHeight: 50,
  },
  textArea: {
    minHeight: 120,
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
    fontSize: 16,
    fontWeight: '600',
  },
});