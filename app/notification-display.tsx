import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, TouchableOpacity } from 'react-native';

export default function NotificationDisplayScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const { message, link } = useLocalSearchParams<{ message: string, link: string }>();

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
            onPress={() => Linking.openURL(link)}>
            <ThemedText style={styles.buttonText}>
              Open Link
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




