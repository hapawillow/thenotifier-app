import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getRepeatNotificationInstanceFireDateTime } from '@/utils/database';

// SQLite CURRENT_TIMESTAMP format is typically "YYYY-MM-DD HH:MM:SS" (UTC).
// JS Date parses that format as *local time*, which causes an 8h offset in PST.
// Normalize to an ISO UTC string so parsing is correct and stable.
const parseSqliteTimestampUtc = (value: string): Date | null => {
  if (!value) return null;
  const trimmed = value.trim();
  // If it already looks like ISO (has 'T') or includes timezone, let Date handle it.
  if (/[tT]/.test(trimmed) || /Z$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Convert "YYYY-MM-DD HH:MM:SS(.sss)?" -> "YYYY-MM-DDTHH:MM:SS(.sss)?Z"
  const isoUtc = trimmed.replace(' ', 'T') + 'Z';
  const d = new Date(isoUtc);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Helper to safely stringify objects with Date handling
const safePretty = (obj: any, indent: number = 2): string => {
  try {
    const replacer = (key: string, value: any) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    };
    return JSON.stringify(obj, replacer, indent);
  } catch (error) {
    return String(obj);
  }
};

export default function OSScheduledNotificationsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [scheduledNotifications, setScheduledNotifications] = useState<Notifications.NotificationRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadScheduledNotifications = useCallback(async () => {
    try {
      const notifications = await Notifications.getAllScheduledNotificationsAsync();

      // Enrich with next trigger dates
      const enriched = await Promise.all(
        notifications.map(async (notif) => {
          let nextTriggerDate: Date | null = null;
          try {
            if (notif.trigger) {
              const trigger = notif.trigger as any;

              // For rolling-window notifications (instance notifications), approximate the OS scheduled time.
              // On iOS, DATE triggers often appear as UNTimeIntervalNotificationTrigger in getAllScheduledNotificationsAsync().
              // The OS stores "seconds" relative to the time the request was scheduled, which iOS does not expose directly.
              // We approximate the scheduling time using the DB row's updatedAt (SQLite CURRENT_TIMESTAMP, UTC),
              // then compute: scheduledFireTimeUtc ~= scheduledAtUtc + trigger.seconds
              if (notif.identifier.startsWith('thenotifier-instance-')) {
                const dbData = await getRepeatNotificationInstanceFireDateTime(notif.identifier);
                if (dbData) {
                  const scheduledAtUtc = parseSqliteTimestampUtc(dbData.updatedAt);
                  const seconds = typeof trigger?.seconds === 'number' ? trigger.seconds : null;

                  if (scheduledAtUtc && seconds != null) {
                    nextTriggerDate = new Date(scheduledAtUtc.getTime() + seconds * 1000);
                  }
                }
              }

              // If we didn't find it in DB, fall back to trigger-based calculation
              if (!nextTriggerDate) {
                // For DATE triggers, use the date directly from the trigger (static scheduled time)
                if (trigger.type === Notifications.SchedulableTriggerInputTypes.DATE && trigger.date) {
                  nextTriggerDate = new Date(trigger.date);
                } else {
                  // For other triggers (DAILY, WEEKLY, etc.), use getNextTriggerDateAsync
                  try {
                    const nextDate = await Notifications.getNextTriggerDateAsync(trigger as Notifications.SchedulableNotificationTriggerInput);
                    if (nextDate) {
                      nextTriggerDate = new Date(nextDate);
                    }
                  } catch (triggerError) {
                    // Some trigger types may not support getNextTriggerDateAsync
                    // Ignore and leave nextTriggerDate as null
                  }
                }
              }
            }
          } catch (error) {
            // Ignore errors getting next trigger date
          }
          return { ...notif, nextTriggerDate };
        })
      );

      // Sort by earliest next trigger time (unknowns last) for easier debugging
      const sorted = [...enriched].sort((a, b) => {
        const aTime = a.nextTriggerDate ? a.nextTriggerDate.getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.nextTriggerDate ? b.nextTriggerDate.getTime() : Number.POSITIVE_INFINITY;
        if (aTime !== bTime) return aTime - bTime;
        return String(a.identifier).localeCompare(String(b.identifier));
      });

      setScheduledNotifications(sorted);
    } catch (error) {
      console.error('Failed to load scheduled notifications:', error);
    }
  }, []);

  useEffect(() => {
    loadScheduledNotifications();
  }, [loadScheduledNotifications]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadScheduledNotifications();
    setRefreshing(false);
  }, [loadScheduledNotifications]);

  const toggleExpand = (identifier: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(identifier)) {
      newExpanded.delete(identifier);
    } else {
      newExpanded.add(identifier);
    }
    setExpandedIds(newExpanded);
  };

  const renderNotificationItem = ({ item }: { item: Notifications.NotificationRequest & { nextTriggerDate?: Date | null } }) => {
    const isExpanded = expandedIds.has(item.identifier);
    // Display in local timezone - toLocaleString() uses system locale and timezone
    const nextTriggerStr = item.nextTriggerDate
      ? item.nextTriggerDate.toLocaleString(undefined, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true,
        timeZoneName: 'short'
      })
      : 'Unknown';

    return (
      <ThemedView style={[styles.notificationCard, { borderColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={styles.cardHeader}
          onPress={() => toggleExpand(item.identifier)}
          activeOpacity={0.7}>
          <ThemedView style={styles.cardHeaderContent}>
            <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.identifier} selectable>
              {item.identifier}
            </ThemedText>
            <ThemedText maxFontSizeMultiplier={1.6} style={styles.nextTrigger} selectable>
              Next: {nextTriggerStr}
            </ThemedText>
          </ThemedView>
          <IconSymbol
            name={isExpanded ? 'chevron.up' : 'chevron.down'}
            size={24}
            color={colors.icon}
          />
        </TouchableOpacity>

        {isExpanded && (
          <ScrollView style={styles.cardContent} nestedScrollEnabled>
            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                Content
              </ThemedText>
              <ThemedText maxFontSizeMultiplier={1.4} style={[styles.jsonText, { color: colors.text }]} selectable>
                {safePretty(item.content)}
              </ThemedText>
            </ThemedView>

            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                Trigger
              </ThemedText>
              <ThemedText maxFontSizeMultiplier={1.4} style={[styles.jsonText, { color: colors.text }]} selectable>
                {safePretty(item.trigger)}
              </ThemedText>
            </ThemedView>

            {item.nextTriggerDate && (
              <ThemedView style={styles.section}>
                <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                  Next Trigger Date
                </ThemedText>
                <ThemedText maxFontSizeMultiplier={1.4} style={styles.nextTrigger} selectable>
                  {item.nextTriggerDate.toISOString()}
                </ThemedText>
              </ThemedView>
            )}

            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                Full Notification Object
              </ThemedText>
              <ThemedText maxFontSizeMultiplier={1.4} style={[styles.jsonText, { color: colors.text }]} selectable>
                {safePretty(item)}
              </ThemedText>
            </ThemedView>
          </ScrollView>
        )}
      </ThemedView>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.4} style={styles.headerTitle}>
          OS Scheduled Notifications
        </ThemedText>
        <ThemedView style={styles.headerSpacer} />
      </ThemedView>

      <ThemedView style={styles.countContainer}>
        <ThemedText maxFontSizeMultiplier={1.4} style={styles.countText}>
          {scheduledNotifications.length} scheduled notification{scheduledNotifications.length !== 1 ? 's' : ''}
        </ThemedText>
      </ThemedView>

      <FlatList
        data={scheduledNotifications}
        renderItem={renderNotificationItem}
        keyExtractor={(item) => item.identifier}
        contentContainerStyle={
          scheduledNotifications.length === 0
            ? styles.emptyListContent
            : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.tint}
            colors={[colors.tint]}
          />
        }
        ListEmptyComponent={
          <ThemedView style={styles.emptyContainer}>
            <ThemedText style={styles.emptyText}>
              No scheduled notifications found
            </ThemedText>
          </ThemedView>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    paddingBottom: 10,
  },
  backButton: {
    padding: 4,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 20,
  },
  headerSpacer: {
    flex: 1,
  },
  countContainer: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  countText: {
    fontSize: 16,
    opacity: 0.7,
  },
  listContent: {
    padding: 20,
    paddingTop: 0,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  notificationCard: {
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  cardHeaderContent: {
    flex: 1,
    marginRight: 12,
  },
  identifier: {
    fontSize: 16,
    marginBottom: 4,
  },
  nextTrigger: {
    fontSize: 14,
    opacity: 0.7,
  },
  cardContent: {
    maxHeight: 600,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    marginBottom: 8,
    opacity: 0.8,
  },
  jsonText: {
    fontSize: 12,
    fontFamily: 'monospace',
    backgroundColor: 'rgba(0,0,0,0.05)',
    padding: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    opacity: 0.6,
  },
});

