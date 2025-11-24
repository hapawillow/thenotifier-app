import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import * as Calendar from 'expo-calendar';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Platform, StyleSheet, TouchableOpacity } from 'react-native';

export default function NotificationDisplayScreen() {

  console.log('NotificationDisplayScreen');

  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const { message, link } = useLocalSearchParams<{ message: string, link: string }>();
  console.log('message', message);
  console.log('link', link);

  const handleOpenLink = async () => {
    if (!link) return;

    // Check if this is a calendar event link
    if (link.startsWith('thenotifier://calendar-event')) {
      try {
        // Parse the calendar event parameters
        const url = new URL(link);
        const eventId = url.searchParams.get('eventId');
        const calendarId = url.searchParams.get('calendarId');
        const startDateStr = url.searchParams.get('startDate');

        if (eventId && calendarId) {
          try {
            // Try to open the event using native calendar URL schemes
            let calendarUrl: string | null = null;

            if (Platform.OS === 'ios') {
              // iOS: Use calshow: scheme with the event's start date timestamp
              // Format: calshow:timestamp (timestamp is seconds since 2001-01-01)
              if (startDateStr) {
                const startDate = new Date(startDateStr);
                const timestamp = Math.floor((startDate.getTime() - new Date('2001-01-01').getTime()) / 1000);
                calendarUrl = `calshow:${timestamp}`;
              }
            } else {
              // Android: Use content:// URI with the event ID
              calendarUrl = `content://com.android.calendar/events/${encodeURIComponent(eventId)}`;
            }

            if (calendarUrl) {
              const canOpen = await Linking.canOpenURL(calendarUrl);
              if (canOpen) {
                await Linking.openURL(calendarUrl);
              } else {
                // Fallback: try to get the event and show details
                const startDate = startDateStr ? new Date(startDateStr) : new Date();
                const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000); // Add 1 day

                const events = await Calendar.getEventsAsync(
                  [calendarId],
                  new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days before
                  endDate
                );

                const event = events.find(e => e.id === eventId);
                if (event) {
                  Alert.alert(
                    'Calendar Event',
                    `Event: ${event.title || 'Untitled'}\n\nTo view this event, please open your calendar app.`,
                    [{ text: 'OK' }]
                  );
                } else {
                  Alert.alert('Error', 'Calendar event not found. Please check your calendar app.');
                }
              }
            } else {
              Alert.alert('Error', 'Unable to generate calendar link for this platform.');
            }
          } catch (error) {
            console.error('Failed to open calendar event:', error);
            Alert.alert('Error', 'Unable to open calendar event. Please open your calendar app manually.');
          }
        } else {
          Alert.alert('Error', 'Invalid calendar event link');
        }
      } catch (error) {
        console.error('Failed to parse calendar link:', error);
        Alert.alert('Error', 'Invalid link format');
      }
    } else {
      // Regular URL - try to open it
      try {
        const canOpen = await Linking.canOpenURL(link);
        if (canOpen) {
          await Linking.openURL(link);
        } else {
          Alert.alert('Error', 'Unable to open this link');
        }
      } catch (error) {
        console.error('Failed to open URL:', error);
        Alert.alert('Error', 'Unable to open link');
      }
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.content}>
        <ThemedText type="title" style={styles.title}>Notification</ThemedText>
        <ThemedView style={styles.messageContainer}>
          <ThemedText style={styles.message}>{message || 'No message available'}</ThemedText>
        </ThemedView>
        {link && (
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.tint }]}
            onPress={handleOpenLink}>
            <ThemedText style={styles.buttonText}>
              {link.startsWith('thenotifier://calendar-event') ? 'Open Calendar Event' : 'Open Link'}
            </ThemedText>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.back()}>
          <ThemedText type="link" style={styles.closeButton}>
            Close
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 20,
  },
  title: {
    textAlign: 'center',
    marginBottom: 20,
  },
  messageContainer: {
    padding: 20,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 76, 121, 0.45)',
  },
  message: {
    fontSize: 16,
    lineHeight: 24,
  },
  closeButton: {
    textAlign: 'center',
    marginTop: 20,
    padding: 10,
  },
  button: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: '#605678',
    fontSize: 16,
    fontWeight: '600',
  },

});




