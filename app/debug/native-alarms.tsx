import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Platform, RefreshControl, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { NativeAlarmManager } from 'notifier-alarm-manager';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { ScheduledAlarm } from 'notifier-alarm-manager';
import { getAllScheduledNotificationData, getAllDailyAlarmInstances } from '@/utils/database';
import { reconcileOrphansOnStartup } from '@/utils/orphan-reconcile';

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

type AlarmWithOrphanStatus = ScheduledAlarm & { isOrphan?: boolean };

export default function NativeAlarmsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [alarms, setAlarms] = useState<AlarmWithOrphanStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [orphanCount, setOrphanCount] = useState(0);

  const loadAlarms = useCallback(async () => {
    try {
      const allAlarms = await NativeAlarmManager.getAllAlarms();
      console.log('[NativeAlarmsDebug] Loaded alarms from native:', allAlarms.length);
      console.log('[NativeAlarmsDebug] Alarm IDs:', allAlarms.map(a => a.id).join(', '));
      
      // Also log what's in the database for comparison
      try {
        const dbNotifications = await getAllScheduledNotificationData();
        const dbAlarms = dbNotifications.filter(n => n.hasAlarm);
        console.log('[NativeAlarmsDebug] Database has', dbAlarms.length, 'alarms with hasAlarm=true');
        console.log('[NativeAlarmsDebug] Database alarm notification IDs:', dbAlarms.map(n => n.notificationId).join(', '));
        
        // Check for mismatches (case-insensitive comparison)
        const dbAlarmIds = new Set(dbAlarms.map(n => {
          const NOTIFIER_PREFIX = 'thenotifier-';
          const id = n.notificationId.startsWith(NOTIFIER_PREFIX) 
            ? n.notificationId.substring(NOTIFIER_PREFIX.length)
            : n.notificationId;
          return id.toLowerCase(); // Normalize to lowercase for comparison
        }));
        const nativeAlarmIds = new Set(allAlarms.map(a => a.id.toLowerCase())); // Normalize to lowercase
        
        const missingFromNative = Array.from(dbAlarmIds).filter(id => !nativeAlarmIds.has(id));
        if (missingFromNative.length > 0) {
          console.warn('[NativeAlarmsDebug] Alarms in database but NOT in native:', missingFromNative.join(', '));
        }
        
        const extraInNative = Array.from(nativeAlarmIds).filter(id => !dbAlarmIds.has(id));
        if (extraInNative.length > 0) {
          console.warn('[NativeAlarmsDebug] Alarms in native but NOT in database:', extraInNative.join(', '));
        }
      } catch (dbError) {
        console.warn('[NativeAlarmsDebug] Failed to compare with database:', dbError);
      }
      
      // Get database notifications to check for orphaned alarms
      let dbScheduledParents: Set<string>;
      let dbScheduledWithAlarms: Set<string>;
      let validAlarmIds: Set<string>;
      let validAlarmCategories: Set<string>;
      
      try {
        const dbScheduledParentsArray = await getAllScheduledNotificationData();
        dbScheduledParents = new Set(dbScheduledParentsArray.map(p => p.notificationId));
        dbScheduledWithAlarms = new Set(
          dbScheduledParentsArray
            .filter(p => p.hasAlarm)
            .map(p => p.notificationId)
        );

        // Build set of valid alarm IDs
        validAlarmIds = new Set<string>();
        validAlarmCategories = new Set<string>();
        const NOTIFIER_PREFIX = 'thenotifier-';
        
        for (const notificationId of dbScheduledWithAlarms) {
          if (notificationId.startsWith(NOTIFIER_PREFIX)) {
            const derivedId = notificationId.substring(NOTIFIER_PREFIX.length);
            validAlarmIds.add(derivedId);
          } else {
            validAlarmIds.add(notificationId);
          }
          validAlarmCategories.add(notificationId);
        }

        // Add alarm IDs from dailyAlarmInstance table
        for (const notificationId of dbScheduledWithAlarms) {
          const instances = await getAllDailyAlarmInstances(notificationId);
          for (const instance of instances) {
            validAlarmIds.add(instance.alarmId);
            if (instance.alarmId.startsWith(NOTIFIER_PREFIX)) {
              validAlarmIds.add(instance.alarmId.substring(NOTIFIER_PREFIX.length));
            }
          }
        }
      } catch (dbError) {
        console.warn('[NativeAlarmsDebug] Failed to load database data:', dbError);
        dbScheduledParents = new Set();
        dbScheduledWithAlarms = new Set();
        validAlarmIds = new Set();
        validAlarmCategories = new Set();
      }
      
      // Validate and filter alarms, mark orphans
      let filteredCount = 0;
      const validAlarms: AlarmWithOrphanStatus[] = allAlarms
        .filter((alarm) => {
          if (!alarm || !alarm.id) {
            console.warn('[NativeAlarmsDebug] Invalid alarm (missing id):', alarm);
            filteredCount++;
            return false;
          }
          
          // Log past-due one-time alarms but don't filter them out (for debugging)
          const scheduleType = alarm.schedule?.type;
          if (scheduleType === 'fixed' && alarm.nextFireDate) {
            try {
              const fireDate = new Date(alarm.nextFireDate);
              if (!isNaN(fireDate.getTime())) {
                const now = new Date();
                // If fire date is in the past, log it but still show it
                if (fireDate < now) {
                  console.warn('[NativeAlarmsDebug] Past-due one-time alarm (should have been cleaned up):', alarm.id, 'fired at:', fireDate.toISOString());
                }
              }
            } catch (e) {
              console.warn('[NativeAlarmsDebug] Error parsing nextFireDate for alarm:', alarm.id, e);
            }
          }
          
          // Validate nextFireDate if present
          if (alarm.nextFireDate) {
            try {
              const fireDate = new Date(alarm.nextFireDate);
              if (isNaN(fireDate.getTime())) {
                console.warn('[NativeAlarmsDebug] Invalid nextFireDate for alarm:', alarm.id, alarm.nextFireDate);
              }
            } catch (e) {
              console.warn('[NativeAlarmsDebug] Error parsing nextFireDate for alarm:', alarm.id, e);
            }
          }
          
          return true;
        })
        .map((alarm) => {
          // Check if alarm is orphaned
          let isOrphan = true;
          const alarmId = alarm.id;

          // Check if alarm ID matches a valid ID
          if (validAlarmIds.has(alarmId)) {
            isOrphan = false;
          }

          // Check Android category match
          if (Platform.OS === 'android' && alarm.category && validAlarmCategories.has(alarm.category)) {
            isOrphan = false;
          }

          // Check config.data.notificationId match
          if (alarm.config?.data?.notificationId) {
            const parentNotificationId = alarm.config.data.notificationId as string;
            if (dbScheduledParents.has(parentNotificationId)) {
              isOrphan = false;
            }
          }

          return { ...alarm, isOrphan };
        });
      
      // Count orphans
      const orphaned = validAlarms.filter(a => a.isOrphan);
      setOrphanCount(orphaned.length);
      
      // Sort by earliest next fire time (unknowns last) for easier debugging
      const sorted = [...validAlarms].sort((a, b) => {
        const aTime = a.nextFireDate && !isNaN(a.nextFireDate.getTime()) 
          ? a.nextFireDate.getTime() 
          : Number.POSITIVE_INFINITY;
        const bTime = b.nextFireDate && !isNaN(b.nextFireDate.getTime())
          ? b.nextFireDate.getTime()
          : Number.POSITIVE_INFINITY;
        if (aTime !== bTime) return aTime - bTime;
        return String(a.id).localeCompare(String(b.id));
      });
      
      console.log('[NativeAlarmsDebug] Valid alarms after filtering:', sorted.length, `(${orphaned.length} orphaned, ${filteredCount} filtered out)`);
      console.log('[NativeAlarmsDebug] Valid alarm IDs:', sorted.map(a => a.id).join(', '));
      setAlarms(sorted);
    } catch (error) {
      console.error('[NativeAlarmsDebug] Failed to load alarms:', error);
      // Set empty array on error to prevent crashes
      setAlarms([]);
      setOrphanCount(0);
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

  const handleCleanupOrphans = useCallback(async () => {
    try {
      await reconcileOrphansOnStartup();
      Alert.alert('Cleanup Complete', 'Orphaned alarms have been cleaned up. Pull to refresh to see updated list.');
      await loadAlarms();
    } catch (error) {
      console.error('[NativeAlarmsDebug] Failed to cleanup orphans:', error);
      Alert.alert('Error', 'Failed to cleanup orphaned alarms. Please try again.');
    }
  }, [loadAlarms]);

  const renderAlarmItem = ({ item }: { item: AlarmWithOrphanStatus }) => {
    const isExpanded = expandedIds.has(item.id);
    const nextFireStr = item.nextFireDate && !isNaN(item.nextFireDate.getTime())
      ? item.nextFireDate.toLocaleString()
      : 'Unknown';

    return (
      <ThemedView style={[styles.alarmCard, { borderColor: item.isOrphan ? '#ff6b6b' : colors.icon + '40' }]}>
        <TouchableOpacity
          style={styles.cardHeader}
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.7}>
          <ThemedView style={styles.cardHeaderContent}>
            <ThemedView style={styles.titleRow}>
              <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.alarmId} selectable>
                {item.config?.title || item.id}
              </ThemedText>
              {item.isOrphan && (
                <ThemedView style={[styles.orphanBadge, { backgroundColor: '#ff6b6b' }]}>
                  <ThemedText maxFontSizeMultiplier={1.2} style={styles.orphanBadgeText}>
                    Orphaned
                  </ThemedText>
                </ThemedView>
              )}
            </ThemedView>
            <ThemedText maxFontSizeMultiplier={1.4} style={styles.alarmSubtitle} selectable>
              ID: {item.id}
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
            {item.isOrphan && (
              <ThemedView style={[styles.section, { backgroundColor: '#ff6b6b20', padding: 12, borderRadius: 8, marginBottom: 8 }]}>
                <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={[styles.sectionTitle, { color: '#ff6b6b' }]}>
                  ⚠️ Orphaned Alarm
                </ThemedText>
                <ThemedText maxFontSizeMultiplier={1.4} style={styles.orphanWarning}>
                  This alarm does not belong to any notification in the database. It may have been deleted or is a leftover from a previous session.
                </ThemedText>
              </ThemedView>
            )}
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

            {item.nextFireDate && !isNaN(item.nextFireDate.getTime()) && (
              <ThemedView style={styles.section}>
                <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                  Next Fire Date (ISO)
                </ThemedText>
                <ThemedText maxFontSizeMultiplier={1.4} style={styles.nextFire} selectable>
                  {item.nextFireDate.toISOString()}
                </ThemedText>
              </ThemedView>
            )}
            {item.nextFireDate && isNaN(item.nextFireDate.getTime()) && (
              <ThemedView style={styles.section}>
                <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.sectionTitle}>
                  Next Fire Date (ISO)
                </ThemedText>
                <ThemedText maxFontSizeMultiplier={1.4} style={styles.nextFire} selectable>
                  Invalid Date
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
        <ThemedView style={styles.countRow}>
          <ThemedText maxFontSizeMultiplier={1.4} style={styles.countText}>
            {alarms.length} scheduled alarm{alarms.length !== 1 ? 's' : ''}
            {orphanCount > 0 && (
              <ThemedText maxFontSizeMultiplier={1.4} style={[styles.countText, { color: '#ff6b6b', marginLeft: 8 }]}>
                ({orphanCount} orphaned)
              </ThemedText>
            )}
          </ThemedText>
          {orphanCount > 0 && (
            <TouchableOpacity
              style={[styles.cleanupButton, { backgroundColor: colors.tint }]}
              onPress={handleCleanupOrphans}
              activeOpacity={0.7}>
              <ThemedText maxFontSizeMultiplier={1.2} style={styles.cleanupButtonText}>
                Cleanup Orphans
              </ThemedText>
            </TouchableOpacity>
          )}
        </ThemedView>
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
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countText: {
    fontSize: 16,
    opacity: 0.7,
  },
  cleanupButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  cleanupButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  orphanBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  orphanBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  orphanWarning: {
    fontSize: 14,
    opacity: 0.9,
    lineHeight: 20,
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
  alarmSubtitle: {
    fontSize: 12,
    opacity: 0.6,
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

