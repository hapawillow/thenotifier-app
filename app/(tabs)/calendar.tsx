import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Calendar from 'expo-calendar';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, FlatList, Platform, StyleSheet, Switch, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type CalendarEvent = {
  id: string;
  originalEventId: string; // Store the original event ID from the calendar system
  calendarId: string;
  calendarName: string;
  title: string;
  startDate: Date;
  endDate: Date;
  description?: string;
  location?: string;
};

export default function CalendarScreen() {
  const [calendars, setCalendars] = useState<Calendar.Calendar[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [animations] = useState<Map<string, Animated.Value>>(new Map());
  const [hiddenEventIds, setHiddenEventIds] = useState<Set<string>>(new Set());
  const [showCalendarSelection, setShowCalendarSelection] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');
  const router = useRouter();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  useEffect(() => {
    let mounted = true;

    const initCalendar = async () => {
      try {
        // First try to check permissions quickly
        const checkPromise = Calendar.getCalendarPermissionsAsync().catch(() => null);
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 1000)
        );

        const result = await Promise.race([checkPromise, timeoutPromise]);

        if (result && mounted) {
          const status = result.status;
          setPermissionStatus(status as 'granted' | 'denied' | 'undetermined');

          if (status === 'granted') {
            await loadCalendars();
          } else if (status === 'undetermined') {
            // Request permission if undetermined
            await requestCalendarPermissions();
          }
        } else if (mounted) {
          // If check timed out or failed, try requesting directly
          console.log('Permission check timed out, requesting directly...');
          await requestCalendarPermissions();
        }
      } catch (error) {
        console.error('Error initializing calendar:', error);
        if (mounted) {
          // On error, try requesting permission directly
          try {
            await requestCalendarPermissions();
          } catch (requestError) {
            console.error('Request also failed:', requestError);
            if (mounted) {
              setPermissionStatus('denied');
            }
          }
        }
      }
    };

    initCalendar();

    return () => {
      mounted = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (calendars.length > 0 && selectedCalendarIds.size > 0) {
        loadEvents();
      }
    }, [selectedCalendarIds, calendars])
  );

  const checkCalendarPermissions = async () => {
    try {
      // Check if Calendar module is available
      if (!Calendar || typeof Calendar.getCalendarPermissionsAsync !== 'function') {
        console.error('Calendar module not available');
        setPermissionStatus('denied');
        return;
      }

      console.log('Checking calendar permissions...');
      const { status } = await Calendar.getCalendarPermissionsAsync();
      console.log('Calendar permission status:', status);

      setPermissionStatus(status as 'granted' | 'denied' | 'undetermined');

      if (status === 'granted') {
        await loadCalendars();
      } else if (status === 'undetermined') {
        // If undetermined, automatically request permission
        console.log('Permission undetermined, requesting...');
        await requestCalendarPermissions();
      }
    } catch (error: any) {
      console.error('Failed to check calendar permissions:', error);
      // Handle MissingCalendarPListValueException gracefully
      if (error?.message?.includes('MissingCalendarPListValueException') ||
        error?.code === 'MissingCalendarPListValueException') {
        setPermissionStatus('denied');
        Alert.alert(
          'Configuration Required',
          'Calendar permissions need to be configured. Please rebuild the app:\n\n1. Stop the current app\n2. Run: npx expo prebuild --clean\n3. Rebuild and run the app',
          [{ text: 'OK' }]
        );
      } else {
        // For other errors, try requesting permission directly
        console.log('Error checking permissions, trying to request directly...');
        setPermissionStatus('undetermined');
        // Try requesting permission as fallback
        try {
          await requestCalendarPermissions();
        } catch (requestError) {
          console.error('Failed to request permissions:', requestError);
          setPermissionStatus('denied');
        }
      }
    }
  };

  const requestCalendarPermissions = async () => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setPermissionStatus(status);
      if (status === 'granted') {
        await loadCalendars();
      } else if (status === 'denied') {
        Alert.alert(
          'Permission Required',
          'Please enable calendar access in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings', onPress: () => {
                // On iOS, we can't directly open settings, but the user can do it manually
                Alert.alert('Settings', 'Please go to Settings > The Notifier > Calendar and enable access.');
              }
            }
          ]
        );
      }
    } catch (error: any) {
      console.error('Failed to request calendar permissions:', error);
      // Don't show alert on MissingCalendarPListValueException - it's a configuration issue
      if (error?.message?.includes('MissingCalendarPListValueException')) {
        Alert.alert(
          'Configuration Error',
          'Calendar permissions are not properly configured. Please rebuild the app after adding calendar permissions to Info.plist.'
        );
      } else {
        Alert.alert('Error', 'Failed to request calendar permissions');
      }
      setPermissionStatus('denied');
    }
  };

  const loadCalendars = async () => {
    try {
      const calendarsList = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      setCalendars(calendarsList);
      // Select all calendars by default
      const defaultSelected = new Set(calendarsList.map(cal => cal.id));
      setSelectedCalendarIds(defaultSelected);
    } catch (error) {
      console.error('Failed to load calendars:', error);
      Alert.alert('Error', 'Failed to load calendars');
    }
  };

  const toggleCalendarSelection = (calendarId: string) => {
    const newSelected = new Set(selectedCalendarIds);
    if (newSelected.has(calendarId)) {
      newSelected.delete(calendarId);
    } else {
      newSelected.add(calendarId);
    }
    setSelectedCalendarIds(newSelected);
  };

  const loadEvents = async () => {
    try {
      if (selectedCalendarIds.size === 0) {
        setEvents([]);
        return;
      }

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);
      endDate.setHours(23, 59, 59, 999);

      const allEvents: CalendarEvent[] = [];

      for (const calendarId of selectedCalendarIds) {
        try {
          const calendarEvents = await Calendar.getEventsAsync(
            [calendarId],
            startDate,
            endDate
          );

          const calendar = calendars.find(cal => cal.id === calendarId);
          const calendarName = calendar?.title || 'Unknown';

          for (const event of calendarEvents) {
            // Create a unique ID that includes calendarId to prevent duplicates
            // Use a more robust unique identifier
            const eventId = event.id || '';
            const startDateStr = event.startDate ? new Date(event.startDate).toISOString() : '';
            const endDateStr = event.endDate ? new Date(event.endDate).toISOString() : '';
            const titleStr = event.title || 'No Title';

            const uniqueId = eventId
              ? `${calendarId}-${eventId}`
              : `${calendarId}-${startDateStr}-${endDateStr}-${titleStr}`;

            allEvents.push({
              id: uniqueId,
              originalEventId: eventId || '', // Store original event ID for opening in calendar app
              calendarId: calendarId,
              calendarName: calendarName,
              title: titleStr,
              startDate: new Date(event.startDate),
              endDate: new Date(event.endDate),
              description: (event as any).description || undefined,
              location: (event as any).location || undefined,
            });
          }
        } catch (error) {
          console.error(`Failed to load events for calendar ${calendarId}:`, error);
        }
      }

      // Remove duplicates based on ID and log if duplicates found
      const uniqueEventsMap = new Map<string, CalendarEvent>();
      const duplicateIds: string[] = [];
      for (const event of allEvents) {
        if (uniqueEventsMap.has(event.id)) {
          duplicateIds.push(event.id);
          console.warn(`Duplicate event ID found: ${event.id}`);
        } else {
          uniqueEventsMap.set(event.id, event);
        }
      }
      const uniqueEvents = Array.from(uniqueEventsMap.values());

      if (duplicateIds.length > 0) {
        console.warn(`Found ${duplicateIds.length} duplicate event IDs:`, duplicateIds);
      }

      // Sort by start date (earliest first)
      uniqueEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      setEvents(uniqueEvents);

      // Initialize animations for new items
      uniqueEvents.forEach((item) => {
        if (!animations.has(item.id)) {
          animations.set(item.id, new Animated.Value(0));
        }
      });
    } catch (error) {
      console.error('Failed to load events:', error);
      Alert.alert('Error', 'Failed to load calendar events');
    }
  };

  useEffect(() => {
    if (selectedCalendarIds.size > 0) {
      loadEvents();
    }
  }, [selectedCalendarIds]);

  const toggleExpand = (id: string) => {
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

  const handleHideEvent = (eventId: string) => {
    const newHidden = new Set(hiddenEventIds);
    newHidden.add(eventId);
    setHiddenEventIds(newHidden);
  };

  const handleScheduleNotification = (event: CalendarEvent) => {
    // Store event details in a custom URL format that we can parse later
    // Format: thenotifier://calendar-event?eventId={eventId}&calendarId={calendarId}&startDate={startDate}
    // This allows us to retrieve the event and open it properly in the native calendar app
    const calendarLink = `thenotifier://calendar-event?eventId=${encodeURIComponent(event.originalEventId)}&calendarId=${encodeURIComponent(event.calendarId)}&startDate=${encodeURIComponent(event.startDate.toISOString())}`;

    // Navigate to the Schedule Notification screen with pre-populated data
    // Try using React Navigation's navigate method for tab navigation
    const params = {
      date: event.startDate.toISOString(),
      shortMessage: event.title,
      longMessage: event.description || '',
      link: calendarLink,
    };

    // Try navigating using React Navigation's navigate method
    // The screen name should match the tab name in _layout.tsx
    try {
      (navigation as any).navigate('index', params);
    } catch (error) {
      // Fallback: use router with href string
      const queryParams = new URLSearchParams(params);
      router.push(`/(tabs)/index?${queryParams.toString()}` as any);
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

  const renderEventItem = ({ item }: { item: CalendarEvent }) => {
    if (hiddenEventIds.has(item.id)) {
      return null;
    }

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
      <ThemedView style={[styles.eventItem, { borderColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={styles.eventHeader}
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.7}>
          <ThemedView style={styles.eventContent}>
            <ThemedText type="defaultSemiBold" style={styles.calendarName}>
              {item.calendarName}
            </ThemedText>
            <ThemedText type="defaultSemiBold" style={styles.title}>
              {item.title}
            </ThemedText>
            <ThemedText style={styles.dateTime}>
              {formatDateTime(item.startDate)}
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
            {item.description && (
              <ThemedView style={styles.detailRow}>
                <ThemedText type="subtitle" style={styles.detailLabel}>
                  Description:
                </ThemedText>
                <ThemedText style={styles.detailValue}>
                  {item.description}
                </ThemedText>
              </ThemedView>
            )}

            {item.location && (
              <ThemedView style={styles.detailRow}>
                <ThemedText type="subtitle" style={styles.detailLabel}>
                  Location:
                </ThemedText>
                <ThemedText style={styles.detailValue}>
                  {item.location}
                </ThemedText>
              </ThemedView>
            )}

            <ThemedView style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#bf3f2f' }]}
                onPress={() => handleHideEvent(item.id)}
                activeOpacity={0.7}>
                <ThemedText style={styles.actionButtonText}>Hide Event</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#499f5d' }]}
                onPress={() => handleScheduleNotification(item)}
                activeOpacity={0.7}>
                <ThemedText style={styles.actionButtonText}>Schedule Notification</ThemedText>
              </TouchableOpacity>
            </ThemedView>
          </ThemedView>
        </Animated.View>
      </ThemedView>
    );
  };

  const visibleEvents = events.filter(event => !hiddenEventIds.has(event.id));

  if (permissionStatus === 'undetermined') {
    return (
      <ThemedView style={styles.container}>
        <ThemedView style={styles.header}>
          <ThemedText type="title">Calendar Events</ThemedText>
        </ThemedView>
        <ThemedView style={styles.emptyContainer}>
          <ThemedText style={styles.emptyText}>Checking calendar permissions...</ThemedText>
        </ThemedView>
      </ThemedView>
    );
  }

  if (permissionStatus === 'denied') {
    return (
      <ThemedView style={styles.container}>
        <ThemedView style={styles.header}>
          <ThemedText type="title">Calendar Events</ThemedText>
        </ThemedView>
        <ThemedView style={styles.emptyContainer}>
          <ThemedText style={styles.emptyText}>(Permission denied)</ThemedText>
          <TouchableOpacity
            style={[styles.calendarButton, { backgroundColor: '#499f5d', marginTop: 20 }]}
            onPress={requestCalendarPermissions}
            activeOpacity={0.7}>
            <ThemedText style={styles.calendarButtonText}>Request Calendar Access</ThemedText>
          </TouchableOpacity>
        </ThemedView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">Calendar Events</ThemedText>
        <TouchableOpacity
          style={[styles.calendarButton]}
          onPress={() => setShowCalendarSelection(!showCalendarSelection)}
          activeOpacity={0.7}>
          <ThemedText style={styles.calendarButtonText}>
            {showCalendarSelection ? 'Hide Calendars' : 'Select Calendars'}
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>

      {showCalendarSelection && (
        <ThemedView style={[styles.calendarSelection, { borderBottomColor: colors.icon + '40' }]}>
          <ThemedText type="subtitle" style={styles.calendarSelectionTitle}>
            Select Calendars:
          </ThemedText>
          <FlatList
            data={calendars}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ThemedView style={[styles.calendarItem, { borderBottomColor: colors.icon + '20' }]}>
                <ThemedText style={styles.calendarItemText}>{item.title}</ThemedText>
                <Switch
                  value={selectedCalendarIds.has(item.id)}
                  onValueChange={() => toggleCalendarSelection(item.id)}
                  trackColor={{ false: '#ddd', true: colors.tint }}
                  thumbColor={Platform.OS === 'ios' ? '#499f5d' : colors.background}
                />
              </ThemedView>
            )}
            style={styles.calendarList}
          />
        </ThemedView>
      )}

      {visibleEvents.length === 0 ? (
        <ThemedView style={styles.emptyContainer}>
          <ThemedText style={styles.emptyText}>
            {selectedCalendarIds.size === 0
              ? 'Select calendars to view events'
              : 'No events found for the next 30 days'}
          </ThemedText>
        </ThemedView>
      ) : (
        <FlatList
          data={visibleEvents}
          renderItem={renderEventItem}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={true}
          alwaysBounceVertical={true}
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
    marginTop: 60,
    marginBottom: 30,
    padding: 20,

    // padding: 20,
    // paddingTop: 60,
    // paddingBottom: 20,
    // gap: 12,
  },
  calendarButton: {
    marginTop: 20,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  calendarButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  calendarSelection: {
    padding: 20,
    borderBottomWidth: 1,
    maxHeight: 300,
  },
  calendarSelectionTitle: {
    marginBottom: 12,
  },
  calendarList: {
    maxHeight: 200,
  },
  calendarItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  calendarItemText: {
    fontSize: 16,
    flex: 1,
  },
  listContent: {
    padding: 20,
    paddingTop: 0,
    flexGrow: 1,
  },
  eventItem: {
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  eventContent: {
    flex: 1,
    marginRight: 12,
    gap: 4,
  },
  calendarName: {
    fontSize: 12,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 18,
    marginBottom: 4,
  },
  dateTime: {
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
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
    fontSize: 16,
    opacity: 0.6,
  },
});

