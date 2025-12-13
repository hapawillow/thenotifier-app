import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ChangedCalendarEvent, formatChangedFields } from '@/utils/calendar-check';
import { saveIgnoredCalendarEvent } from '@/utils/database';
import { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity } from 'react-native';

type CalendarChangeModalProps = {
  visible: boolean;
  changedEvents: ChangedCalendarEvent[];
  onClose: () => void;
};

export function CalendarChangeModal({ visible, changedEvents, onClose }: CalendarChangeModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [ignoredEventKeys, setIgnoredEventKeys] = useState<Set<string>>(new Set());

  const handleIgnore = useCallback(async (event: ChangedCalendarEvent) => {
    try {
      await saveIgnoredCalendarEvent(event.calendarId, event.originalEventId);
      const eventKey = `${event.calendarId}-${event.originalEventId}`;
      setIgnoredEventKeys(prev => new Set(prev).add(eventKey));
    } catch (error) {
      console.error('Failed to ignore calendar event:', error);
    }
  }, []);

  // Reset ignored events when modal closes or events change
  useEffect(() => {
    if (!visible) {
      setIgnoredEventKeys(new Set());
    }
  }, [visible]);

  // Filter out ignored events
  const visibleEvents = changedEvents.filter(event => {
    const eventKey = `${event.calendarId}-${event.originalEventId}`;
    return !ignoredEventKeys.has(eventKey);
  });

  const formatDateTime = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (!visible || visibleEvents.length === 0) {
    // If all events were ignored, close the modal
    if (changedEvents.length > 0 && visibleEvents.length === 0) {
      onClose();
    }
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <ThemedView style={styles.overlay}>
        <ThemedView style={[styles.modalContainer, { backgroundColor: colors.background, borderColor: colors.icon + '40' }]}>
          <ThemedView style={styles.content}>
            <ThemedText type="title" maxFontSizeMultiplier={1.6} style={styles.title}>
              Calendar Updates Detected
            </ThemedText>

            <ThemedText maxFontSizeMultiplier={1.6} style={styles.message}>
              We found updates to your calendar that might affect your upcoming notifications. You should review them and make edits if needed.
            </ThemedText>

            <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.subtitle}>
              Calendar details have changed for:
            </ThemedText>

            <ThemedView style={styles.eventsList}>
              {visibleEvents.map((event, index) => {
                const eventKey = `${event.calendarId}-${event.originalEventId}`;
                return (
                  <ThemedView key={index} style={[styles.eventItem, { borderBottomColor: colors.icon + '20' }]}>
                    <ThemedView style={styles.eventContent}>
                      <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.calendarName}>
                        {event.calendarName}
                      </ThemedText>
                      <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.eventTitle}>
                        {event.title}
                      </ThemedText>
                      <ThemedText maxFontSizeMultiplier={1.6} style={styles.eventDate}>
                        {formatDateTime(event.startDate)}
                      </ThemedText>
                      {event.isDeleted ? (
                        <ThemedText maxFontSizeMultiplier={1.6} style={[styles.changeText, { fontStyle: 'italic', color: colors.icon }]}>
                          This event was removed from your calendar
                        </ThemedText>
                      ) : event.changedFields && event.changedFields.length > 0 ? (
                        <ThemedText maxFontSizeMultiplier={1.6} style={[styles.changeText, { fontStyle: 'italic', color: colors.icon }]}>
                          {formatChangedFields(event.changedFields)}
                        </ThemedText>
                      ) : null}
                    </ThemedView>
                    <TouchableOpacity
                      style={[styles.ignoreButton, { borderColor: colors.tint }]}
                      onPress={() => handleIgnore(event)}
                      activeOpacity={0.7}
                    >
                      <ThemedText maxFontSizeMultiplier={1.2} style={[styles.ignoreButtonText, { color: colors.tint }]}>
                        Ignore
                      </ThemedText>
                    </TouchableOpacity>
                  </ThemedView>
                );
              })}
            </ThemedView>

            <TouchableOpacity
              style={[styles.okButton, { backgroundColor: colors.tint }]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <ThemedText maxFontSizeMultiplier={1.6} style={[styles.okButtonText, { color: colors.buttonText }]}>
                Ok
              </ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </ThemedView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 500,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: '80%',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    marginBottom: 16,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 18,
    marginBottom: 12,
    fontWeight: '600',
  },
  eventsList: {
    maxHeight: 300,
    marginBottom: 20,
  },
  eventItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  eventContent: {
    flex: 1,
    marginRight: 12,
  },
  ignoreButton: {
    borderWidth: 1,
    borderRadius: 50,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ignoreButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  calendarName: {
    fontSize: 14,
    opacity: 0.7,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  eventTitle: {
    fontSize: 18,
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 16,
    opacity: 0.8,
    marginBottom: 6,
  },
  changeText: {
    fontSize: 14,
    opacity: 0.8,
  },
  okButton: {
    padding: 14,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  okButtonText: {
    fontSize: 18,
    fontWeight: '600',
  },
});

