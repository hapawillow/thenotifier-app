import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { NativeAlarmManager } from 'notifier-alarm-manager';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScheduledAlarm } from 'notifier-alarm-manager/src/types';

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

export default function NativeAlarmsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [alarms, setAlarms] = useState<ScheduledAlarm[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadAlarms = useCallback(async () => {
    try {
      const allAlarms = await NativeAlarmManager.getAllAlarms();
      console.log('[NativeAlarmsDebug] Loaded alarms:', allAlarms.length);
      
      // Validate and filter alarms
      const validAlarms = allAlarms.filter((alarm) => {
        if (!alarm || !alarm.id) {
          console.warn('[NativeAlarmsDebug] Invalid alarm (missing id):', alarm);
          return false;
        }
        
        // Validate nextFireDate if present
        if (alarm.nextFireDate) {
          try {
            const fireDate = new Date(alarm.nextFireDate);
            if (isNaN(fireDate.getTime())) {
              console.warn('[NativeAlarmsDebug] Invalid nextFireDate for alarm:', alarm.id, alarm.nextFireDate);
              // Don't filter out - just log the warning
            }
          } catch (e) {
            console.warn('[NativeAlarmsDebug] Error parsing nextFireDate for alarm:', alarm.id, e);
          }
        }
        
        return true;
      });
      
      // Sort by earliest next fire time (unknowns last) for easier debugging
      const sorted = [...validAlarms].sort((a, b) => {
        const aTime = a.nextFireDate ? new Date(a.nextFireDate).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.nextFireDate ? new Date(b.nextFireDate).getTime() : Number.POSITIVE_INFINITY;
        if (aTime !== bTime) return aTime - bTime;
        return String(a.id).localeCompare(String(b.id));
      });
      
      console.log('[NativeAlarmsDebug] Valid alarms after filtering:', sorted.length);
      setAlarms(sorted);
    } catch (error) {
      console.error('[NativeAlarmsDebug] Failed to load alarms:', error);
      // Set empty array on error to prevent crashes
      setAlarms([]);
    }
  }, []);

  useEffect(() => {
    loadAlarms();
  }, [loadAlarms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAlarms();
    setRefreshing(false);
  }, [loadAlarms]);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const renderAlarmItem = ({ item }: { item: ScheduledAlarm }) => {
    const isExpanded = expandedIds.has(item.id);
    const nextFireStr = item.nextFireDate 
      ? item.nextFireDate.toLocaleString()
      : 'Unknown';

    return (
      <ThemedView style={[styles.alarmCard, { borderColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={styles.cardHeader}
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.7}>
          <ThemedView style={styles.cardHeaderContent}>
            <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.alarmId} selectable>
              {item.id}
            </ThemedText>
            <ThemedText maxFontSizeMultiplier={1.6} style={styles.nextFire} selectable>
              Next Fire: {nextFireStr}
            </ThemedText>
            {item.isActive !== undefined && (
              <ThemedText maxFontSizeMultiplier={1.4} style={styles.activeStatus} selectable>
                Active: {item.isActive ? 'Yes' : 'No'}
              </ThemedText>
            )}
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
                Schedule
              </ThemedText>
              <ThemedText maxFontSizeMultiplier={1.4} style={[styles.jsonText, { color: colors.text }]} selectable>
                {safePretty(item.schedule)}
              </ThemedText>
            </ThemedView>

            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                Config
              </ThemedText>
              <ThemedText maxFontSizeMultiplier={1.4} style={[styles.jsonText, { color: colors.text }]} selectable>
                {safePretty(item.config)}
              </ThemedText>
            </ThemedView>

            {item.category && (
              <ThemedView style={styles.section}>
                <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                  Category
                </ThemedText>
                <ThemedText maxFontSizeMultiplier={1.4} style={styles.category} selectable>
                  {item.category}
                </ThemedText>
              </ThemedView>
            )}

            {item.nextFireDate && (
              <ThemedView style={styles.section}>
                <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                  Next Fire Date (ISO)
                </ThemedText>
                <ThemedText maxFontSizeMultiplier={1.4} style={styles.nextFire} selectable>
                  {item.nextFireDate.toISOString()}
                </ThemedText>
              </ThemedView>
            )}

            <ThemedView style={styles.section}>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                Full Alarm Object
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
          Native Scheduled Alarms
        </ThemedText>
        <ThemedView style={styles.headerSpacer} />
      </ThemedView>

      <ThemedView style={styles.countContainer}>
        <ThemedText maxFontSizeMultiplier={1.4} style={styles.countText}>
          {alarms.length} scheduled alarm{alarms.length !== 1 ? 's' : ''}
        </ThemedText>
      </ThemedView>

      <FlatList
        data={alarms}
        renderItem={renderAlarmItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          alarms.length === 0
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
              No scheduled alarms found
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
  alarmCard: {
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
  alarmId: {
    fontSize: 16,
    marginBottom: 4,
  },
  nextFire: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 2,
  },
  activeStatus: {
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
  category: {
    fontSize: 14,
    opacity: 0.8,
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

