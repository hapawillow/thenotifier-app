import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, Dimensions, FlatList, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteScheduledNotification, getAllArchivedNotificationData, getAllScheduledNotificationData } from '@/utils/database';

type ScheduledNotification = {
  id: number;
  notificationId: string;
  title: string;
  shortMessage: string;
  longMessage: string;
  link: string;
  scheduleDateTime: string;
  scheduleDateTimeLocal: string;
  createdAt: string;
  updatedAt: string;
};

type ArchivedNotification = {
  id: number;
  notificationId: string;
  title: string;
  shortMessage: string;
  longMessage: string;
  link: string;
  scheduleDateTime: string;
  scheduleDateTimeLocal: string;
  createdAt: string;
  updatedAt: string;
  handledAt: string | null;
  cancelledAt: string | null;
  archivedAt: string;
};

type TabType = 'scheduled' | 'archived';

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState<TabType>('scheduled');
  const [scheduledNotifications, setScheduledNotifications] = useState<ScheduledNotification[]>([]);
  const [archivedNotifications, setArchivedNotifications] = useState<ArchivedNotification[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [animations] = useState<Map<number, Animated.Value>>(new Map());
  const [refreshingScheduled, setRefreshingScheduled] = useState(false);
  const [refreshingArchived, setRefreshingArchived] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const loadScheduledNotifications = async () => {
    try {
      // Archive past notifications first
      const { archiveScheduledNotifications } = await import('@/utils/database');
      await archiveScheduledNotifications();
      // Small delay to ensure database operations complete
      await new Promise(resolve => setTimeout(resolve, 50));
      // Then load the updated list
      const data = await getAllScheduledNotificationData();
      // Filter out any past notifications that might still be in the database
      const now = new Date().toISOString();
      const futureNotifications = data.filter(item => item.scheduleDateTime > now);
      setScheduledNotifications(futureNotifications);
      // Initialize animations for new items
      futureNotifications.forEach((item) => {
        if (!animations.has(item.id)) {
          animations.set(item.id, new Animated.Value(0));
        }
      });
    } catch (error) {
      console.error('Failed to load scheduled notifications:', error);
    }
  };

  const loadArchivedNotifications = async () => {
    try {
      const data = await getAllArchivedNotificationData();
      setArchivedNotifications(data);
      // Initialize animations for new items
      data.forEach((item) => {
        if (!animations.has(item.id)) {
          animations.set(item.id, new Animated.Value(0));
        }
      });
    } catch (error) {
      console.error('Failed to load archived notifications:', error);
    }
  };

  const loadAllNotifications = async () => {
    await Promise.all([loadScheduledNotifications(), loadArchivedNotifications()]);
  };

  const onRefreshScheduled = useCallback(async () => {
    setRefreshingScheduled(true);
    await loadScheduledNotifications();
    setRefreshingScheduled(false);
  }, []);

  const onRefreshArchived = useCallback(async () => {
    setRefreshingArchived(true);
    await loadArchivedNotifications();
    setRefreshingArchived(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAllNotifications();
    }, [])
  );

  useEffect(() => {
    // Refresh when notifications are received
    const unsubscribe = Notifications.addNotificationReceivedListener(() => {
      // Small delay to ensure database is updated
      setTimeout(() => {
        loadAllNotifications();
      }, 100);
    });
    return () => {
      unsubscribe.remove();
    };
  }, []);

  const toggleExpand = (id: number) => {
    const isExpanded = expandedIds.has(id);
    const newExpandedIds = new Set(expandedIds);

    if (isExpanded) {
      newExpandedIds.delete(id);
    } else {
      newExpandedIds.add(id);
    }

    setExpandedIds(newExpandedIds);

    // Animate drawer
    const animValue = animations.get(id) || new Animated.Value(0);
    if (!animations.has(id)) {
      animations.set(id, animValue);
    }

    Animated.timing(animValue, {
      toValue: isExpanded ? 0 : 1,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const handleDelete = async (notification: ScheduledNotification) => {
    Alert.alert(
      'Delete Notification',
      'Are you sure you want to cancel this scheduled notification?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Cancel the scheduled notification
              await Notifications.cancelScheduledNotificationAsync(notification.notificationId);
              // Delete from database
              await deleteScheduledNotification(notification.notificationId);
              // Reload notifications
              await loadAllNotifications();
              Alert.alert('Success', 'Notification cancelled successfully');
            } catch (error) {
              console.error('Failed to delete notification:', error);
              Alert.alert('Error', 'Failed to cancel notification');
            }
          },
        },
      ]
    );
  };

  const handleEdit = (notification: ScheduledNotification) => {
    // TODO: Navigate to edit screen or implement inline editing
    Alert.alert('Edit Notification', 'Edit functionality will be implemented soon');
  };

  const renderScheduledNotificationItem = ({ item }: { item: ScheduledNotification }) => {
    const isExpanded = expandedIds.has(item.id);
    const animValue = animations.get(item.id) || new Animated.Value(0);

    const drawerHeight = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 300],
    });

    const opacity = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    return (
      <ThemedView style={[styles.notificationItem, { borderColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={styles.notificationHeader}
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.7}>
          <ThemedView style={styles.notificationContent}>
            <ThemedText type="defaultSemiBold" style={styles.title}>
              {item.title}
            </ThemedText>
            <ThemedText style={styles.shortMessage} numberOfLines={2}>
              {item.shortMessage}
            </ThemedText>
          </ThemedView>
          <IconSymbol
            name={isExpanded ? 'chevron.up' : 'chevron.down'}
            size={24}
            color={colors.icon}
          />
        </TouchableOpacity>

        <Animated.View
          style={[
            styles.drawer,
            {
              height: drawerHeight,
              opacity: opacity,
              overflow: 'hidden',
              borderTopColor: colors.icon + '40',
            },
          ]}>
          <ThemedView style={styles.drawerContent}>
            <ThemedView style={styles.detailRow}>
              <ThemedText type="subtitle" style={styles.detailLabel}>
                Scheduled Time:
              </ThemedText>
              <ThemedText style={styles.detailValue}>
                {item.scheduleDateTimeLocal}
              </ThemedText>
            </ThemedView>

            <ThemedView style={styles.detailRow}>
              <ThemedText type="subtitle" style={styles.detailLabel}>
                Long Message:
              </ThemedText>
              <ThemedText style={styles.detailValue}>
                {item.longMessage}
              </ThemedText>
            </ThemedView>

            {item.link && (
              <ThemedView style={styles.detailRow}>
                <ThemedText type="subtitle" style={styles.detailLabel}>
                  Link:
                </ThemedText>
                <ThemedText style={styles.detailValue} numberOfLines={1}>
                  {item.link}
                </ThemedText>
              </ThemedView>
            )}

            <ThemedView style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.tint }]}
                onPress={() => handleEdit(item)}
                activeOpacity={0.7}>
                <IconSymbol name="pencil" size={20} color="#fff" />
                <ThemedText style={styles.actionButtonText}>Edit</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#d32f2f' }]}
                onPress={() => handleDelete(item)}
                activeOpacity={0.7}>
                <IconSymbol name="trash" size={20} color="#fff" />
                <ThemedText style={styles.actionButtonText}>Delete</ThemedText>
              </TouchableOpacity>
            </ThemedView>
          </ThemedView>
        </Animated.View>
      </ThemedView>
    );
  };

  const renderArchivedNotificationItem = ({ item }: { item: ArchivedNotification }) => {
    const isExpanded = expandedIds.has(item.id);
    const animValue = animations.get(item.id) || new Animated.Value(0);

    const drawerHeight = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 250],
    });

    const opacity = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    return (
      <ThemedView style={[styles.notificationItem, { borderColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={styles.notificationHeader}
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.7}>
          <ThemedView style={styles.notificationContent}>
            <ThemedText type="defaultSemiBold" style={styles.title}>
              {item.title}
            </ThemedText>
            <ThemedText style={styles.shortMessage} numberOfLines={2}>
              {item.shortMessage}
            </ThemedText>
          </ThemedView>
          <IconSymbol
            name={isExpanded ? 'chevron.up' : 'chevron.down'}
            size={24}
            color={colors.icon}
          />
        </TouchableOpacity>

        <Animated.View
          style={[
            styles.drawer,
            {
              height: drawerHeight,
              opacity: opacity,
              overflow: 'hidden',
              borderTopColor: colors.icon + '40',
            },
          ]}>
          <ThemedView style={styles.drawerContent}>
            <ThemedView style={styles.detailRow}>
              <ThemedText type="subtitle" style={styles.detailLabel}>
                Scheduled Time:
              </ThemedText>
              <ThemedText style={styles.detailValue}>
                {item.scheduleDateTimeLocal}
              </ThemedText>
            </ThemedView>

            <ThemedView style={styles.detailRow}>
              <ThemedText type="subtitle" style={styles.detailLabel}>
                Long Message:
              </ThemedText>
              <ThemedText style={styles.detailValue}>
                {item.longMessage}
              </ThemedText>
            </ThemedView>

            {item.link && (
              <ThemedView style={styles.detailRow}>
                <ThemedText type="subtitle" style={styles.detailLabel}>
                  Link:
                </ThemedText>
                <ThemedText style={styles.detailValue} numberOfLines={1}>
                  {item.link}
                </ThemedText>
              </ThemedView>
            )}
          </ThemedView>
        </Animated.View>
      </ThemedView>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">Notifications</ThemedText>
      </ThemedView>

      <ThemedView style={[styles.tabContainer, { borderBottomColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'scheduled' && [styles.activeTab, { borderBottomColor: colors.tint }],
          ]}
          onPress={() => setActiveTab('scheduled')}
          activeOpacity={0.7}>
          <ThemedText
            type="defaultSemiBold"
            style={[
              styles.tabText,
              activeTab === 'scheduled' && { color: colors.tint },
            ]}>
            Scheduled
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'archived' && [styles.activeTab, { borderBottomColor: colors.tint }],
          ]}
          onPress={() => setActiveTab('archived')}
          activeOpacity={0.7}>
          <ThemedText
            type="defaultSemiBold"
            style={[
              styles.tabText,
              activeTab === 'archived' && { color: colors.tint },
            ]}>
            Archived
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>

      {activeTab === 'scheduled' ? (
        <FlatList
          data={scheduledNotifications}
          renderItem={renderScheduledNotificationItem}
          keyExtractor={(item) => item.notificationId}
          contentContainerStyle={
            scheduledNotifications.length === 0
              ? styles.emptyListContent
              : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          scrollEnabled={true}
          alwaysBounceVertical={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshingScheduled}
              onRefresh={onRefreshScheduled}
              tintColor={colors.tint}
              colors={[colors.tint]}
            />
          }
          ListEmptyComponent={
            <ThemedView style={styles.emptyContainer}>
              <ThemedText style={styles.emptyText}>
                No scheduled notifications
              </ThemedText>
            </ThemedView>
          }
        />
      ) : (
        <FlatList
          data={archivedNotifications}
          renderItem={renderArchivedNotificationItem}
          keyExtractor={(item) => item.notificationId}
          contentContainerStyle={
            archivedNotifications.length === 0
              ? styles.emptyListContent
              : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          scrollEnabled={true}
          alwaysBounceVertical={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshingArchived}
              onRefresh={onRefreshArchived}
              tintColor={colors.tint}
              colors={[colors.tint]}
            />
          }
          ListEmptyComponent={
            <ThemedView style={styles.emptyContainer}>
              <ThemedText style={styles.emptyText}>
                No archived notifications
              </ThemedText>
            </ThemedView>
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 16,
  },
  listContent: {
    padding: 20,
    paddingTop: 0,
    flexGrow: 1,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    minHeight: Dimensions.get('window').height - 200, // Ensure enough height for pull-to-refresh
  },
  notificationItem: {
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  notificationContent: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    marginBottom: 4,
  },
  shortMessage: {
    fontSize: 14,
    opacity: 0.8,
  },
  drawer: {
    borderTopWidth: 1,
  },
  drawerContent: {
    padding: 16,
    gap: 12,
  },
  detailRow: {
    gap: 4,
  },
  detailLabel: {
    fontSize: 14,
    opacity: 0.7,
  },
  detailValue: {
    fontSize: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    opacity: 0.6,
  },
});
