import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useNavigation, useRouter } from 'expo-router';
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
  message: string;
  note: string;
  link: string;
  scheduleDateTime: string;
  scheduleDateTimeLocal: string;
  repeatOption: string | null;
  notificationTrigger: any; // Notifications.NotificationTriggerInput | undefined
  hasAlarm: boolean;
  calendarId?: string | null;
  originalEventId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ArchivedNotification = {
  id: number;
  notificationId: string;
  title: string;
  message: string;
  note: string;
  link: string;
  scheduleDateTime: string;
  scheduleDateTimeLocal: string;
  repeatOption: string | null;
  notificationTrigger: any; // Notifications.NotificationTriggerInput | undefined
  hasAlarm: boolean;
  calendarId?: string | null;
  originalEventId?: string | null;
  createdAt: string;
  updatedAt: string;
  handledAt: string | null;
  cancelledAt: string | null;
  archivedAt: string;
};

type TabType = 'scheduled' | 'archived';

export default function HomeScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('scheduled');
  const [scheduledNotifications, setScheduledNotifications] = useState<ScheduledNotification[]>([]);
  const [archivedNotifications, setArchivedNotifications] = useState<ArchivedNotification[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [animations] = useState<Map<number, Animated.Value>>(new Map());
  const [drawerHeights] = useState<Map<number, number>>(new Map());
  const [drawerHeightUpdateTrigger, setDrawerHeightUpdateTrigger] = useState(0);
  const [refreshingScheduled, setRefreshingScheduled] = useState(false);
  const [refreshingArchived, setRefreshingArchived] = useState(false);
  const navigation = useNavigation();
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
      const notifications = await getAllScheduledNotificationData();
      setScheduledNotifications(notifications);

      // Initialize animations for new items
      notifications.forEach((item) => {
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
    const params: any = {
      editMode: 'true',
      notificationId: notification.notificationId,
      title: notification.title,
      message: notification.message,
      note: notification.note,
      link: notification.link,
      date: notification.scheduleDateTime,
      repeat: notification.repeatOption || 'none',
      hasAlarm: notification.hasAlarm.toString(),
    };

    try {
      (navigation as any).navigate('schedule', params);
      console.log('handleEdit: Navigating to schedule screen with params using navigate:', params);
    } catch (error) {
      // Fallback: use router with href string
      console.log('handleEdit: Navigating to schedule screen with params using router:', params);
      const queryParams = new URLSearchParams(params);
      router.push(`/(tabs)/schedule?${queryParams.toString()}` as any);
    }

    //   const queryParams = new URLSearchParams(params);
    //   router.push(`/(tabs)/schedule?${queryParams.toString()}` as any);
  };

  // Format date string to remove seconds
  const formatDateTimeWithoutSeconds = (dateTimeString: string): string => {
    try {
      const date = new Date(dateTimeString);
      // If date is invalid, try parsing as locale string
      if (isNaN(date.getTime())) {
        // Try to parse common formats and remove seconds
        // Handle formats like "12/7/2024, 3:45:30 PM"
        return dateTimeString.replace(/:\d{2}(?=\s*(?:AM|PM|$))/i, '');
      }
      // Format without seconds
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (error) {
      // Fallback: try to remove seconds pattern from string
      return dateTimeString.replace(/:\d{2}(?=\s*(?:AM|PM|$))/i, '');
    }
  };

  // Format repeat option text for display
  const formatRepeatOption = (repeatOption: string | null, scheduleDateTime: string): string => {
    if (!repeatOption || repeatOption === 'none') {
      return '';
    }

    try {
      const date = new Date(scheduleDateTime);
      if (isNaN(date.getTime())) {
        return '';
      }

      switch (repeatOption) {
        case 'daily': {
          const timeStr = date.toLocaleString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          });
          return `Repeats every day at ${timeStr}`;
        }
        case 'weekly': {
          const dayOfWeek = date.toLocaleString('en-US', { weekday: 'long' });
          return `Repeats every week on ${dayOfWeek}`;
        }
        case 'monthly': {
          const day = date.getDate();
          const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
          return `Repeats every month on the ${day}${suffix}`;
        }
        case 'yearly':
          return 'Repeats every year';
        default:
          return '';
      }
    } catch (error) {
      console.error('Error formatting repeat option:', error);
      return '';
    }
  };

  const renderScheduledNotificationItem = ({ item }: { item: ScheduledNotification }) => {
    const isExpanded = expandedIds.has(item.id);
    const animValue = animations.get(item.id) || new Animated.Value(0);
    const measuredHeight = drawerHeights.get(item.id) || 300; // Default fallback height

    const drawerHeight = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, measuredHeight],
    });

    const opacity = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    const handleDrawerContentLayout = (event: any) => {
      const { height } = event.nativeEvent.layout;
      // The measured height already includes padding (16px on all sides)
      // Store the height for use in animation
      const currentHeight = drawerHeights.get(item.id);
      if (currentHeight !== height) {
        drawerHeights.set(item.id, height);
        // Trigger re-render to update animation with new height
        setDrawerHeightUpdateTrigger(prev => prev + 1);
      }
    };

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
            <ThemedText style={styles.message} numberOfLines={2}>
              {item.message}
            </ThemedText>
            <ThemedView style={styles.dateTimeRow}>
              <ThemedText style={styles.message} numberOfLines={1}>
                {formatDateTimeWithoutSeconds(item.scheduleDateTimeLocal)}
              </ThemedText>
              {item.hasAlarm && (
                <IconSymbol
                  name="bell.fill"
                  size={16}
                  color={colors.icon}
                  style={styles.icon}
                />
              )}
              {item.repeatOption && item.repeatOption !== 'none' && (
                <IconSymbol
                  name="repeat"
                  size={16}
                  color={colors.icon}
                  style={styles.icon}
                />
              )}
            </ThemedView>
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
          <ThemedView
            style={styles.drawerContent}
            onLayout={handleDrawerContentLayout}>
            {item.repeatOption && item.repeatOption !== 'none' && (
              <ThemedView style={styles.detailRow}>
                <ThemedText type="subtitle" style={styles.detailLabel}>
                  Repeat:
                </ThemedText>
                <ThemedText style={styles.detailValue}>
                  {formatRepeatOption(item.repeatOption, item.scheduleDateTime)}
                </ThemedText>
              </ThemedView>
            )}

            {item.note && (
              <ThemedView style={styles.detailRow}>
                <ThemedText type="subtitle" style={styles.detailLabel}>
                  Note:
                </ThemedText>
                <ThemedText style={styles.detailValue}>
                  {item.note}
                </ThemedText>
              </ThemedView>
            )}

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
                style={[styles.actionButton, { backgroundColor: colors.deleteButton }]}
                onPress={() => handleDelete(item)}
                activeOpacity={0.7}>
                <IconSymbol name="trash" size={20} color={colors.deleteButtonText} />
                <ThemedText style={[styles.actionButtonText, { color: colors.deleteButtonText }]}>Delete</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.tint }]}
                onPress={() => handleEdit(item)}
                activeOpacity={0.7}>
                <IconSymbol name="pencil" size={20} color={colors.buttonText} />
                <ThemedText style={[styles.actionButtonText, { color: colors.buttonText }]}>Edit</ThemedText>
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
    const measuredHeight = drawerHeights.get(item.id) || 250; // Default fallback height

    // Check if item has any expandable content (repeat option, note, or link)
    const hasRepeatOption = item.repeatOption && item.repeatOption !== 'none';
    const hasNote = item.note && item.note.trim().length > 0;
    const hasLink = item.link && item.link.trim().length > 0;
    const hasExpandableContent = hasRepeatOption || hasNote || hasLink;

    const drawerHeight = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, measuredHeight],
    });

    const opacity = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    const handleDrawerContentLayout = (event: any) => {
      const { height } = event.nativeEvent.layout;
      // The measured height already includes padding (16px on all sides)
      // Store the height for use in animation
      const currentHeight = drawerHeights.get(item.id);
      if (currentHeight !== height) {
        drawerHeights.set(item.id, height);
        // Trigger re-render to update animation with new height
        setDrawerHeightUpdateTrigger(prev => prev + 1);
      }
    };

    const headerContent = (
      <>
        <ThemedView style={styles.notificationContent}>
          <ThemedText type="defaultSemiBold" style={styles.title}>
            {item.title}
          </ThemedText>
          <ThemedText style={styles.message} numberOfLines={2}>
            {item.message}
          </ThemedText>
          <ThemedView style={styles.dateTimeRow}>
            <ThemedText style={styles.message} numberOfLines={1}>
              {formatDateTimeWithoutSeconds(item.scheduleDateTimeLocal)}
            </ThemedText>
            {item.hasAlarm && (
              <IconSymbol
                name="bell.fill"
                size={16}
                color={colors.icon}
                style={styles.icon}
              />
            )}
            {hasRepeatOption && (
              <IconSymbol
                name="repeat"
                size={16}
                color={colors.icon}
                style={styles.icon}
              />
            )}
          </ThemedView>
        </ThemedView>
        {hasExpandableContent && (
          <IconSymbol
            name={isExpanded ? 'chevron.up' : 'chevron.down'}
            size={24}
            color={colors.icon}
          />
        )}
      </>
    );

    return (
      <ThemedView style={[styles.notificationItem, { borderColor: colors.icon + '40' }]}>
        {hasExpandableContent ? (
          <TouchableOpacity
            style={styles.notificationHeader}
            onPress={() => toggleExpand(item.id)}
            activeOpacity={0.7}>
            {headerContent}
          </TouchableOpacity>
        ) : (
          <ThemedView style={styles.notificationHeader}>
            {headerContent}
          </ThemedView>
        )}

        {hasExpandableContent && (
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
            <ThemedView
              style={styles.drawerContent}
              onLayout={handleDrawerContentLayout}>
              {hasRepeatOption && (
                <ThemedView style={styles.detailRow}>
                  <ThemedText type="subtitle" style={styles.detailLabel}>
                    Repeat:
                  </ThemedText>
                  <ThemedText style={styles.detailValue}>
                    {formatRepeatOption(item.repeatOption!, item.scheduleDateTime)}
                  </ThemedText>
                </ThemedView>
              )}

              {hasNote && (
                <ThemedView style={styles.detailRow}>
                  <ThemedText type="subtitle" style={styles.detailLabel}>
                    Note:
                  </ThemedText>
                  <ThemedText style={styles.detailValue}>
                    {item.note}
                  </ThemedText>
                </ThemedView>
              )}

              {hasLink && (
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
        )}
      </ThemedView>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
        {/* <ThemedText type="title">Notifications</ThemedText> */}
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
            Upcoming
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
            Past
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
                No upcoming notifications
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
                No sent notifications
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
    marginTop: 40,
    // marginBottom: 30,
    padding: 20,
  },
  tabContainer: {
    flexDirection: 'row',
    // borderBottomWidth: 1,
    marginBottom: 15,
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
    fontSize: 18,
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
  message: {
    fontSize: 18,
    opacity: 0.8,
  },
  drawer: {
    borderTopWidth: 1,
  },
  drawerContent: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  detailRow: {
    gap: 4,
  },
  detailLabel: {
    fontSize: 18,
    opacity: 0.7,
  },
  detailValue: {
    fontSize: 18,
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
    borderRadius: 50,
    gap: 8,
  },
  actionButtonText: {
    color: '#8ddaff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
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
  dateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    marginLeft: 4,
  },
});
