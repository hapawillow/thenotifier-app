import { useFocusEffect } from '@react-navigation/native';
import * as Calendar from 'expo-calendar';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, FlatList, Platform, StyleSheet, Switch, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { checkCalendarEventChanges } from '@/utils/calendar-check';
import { checkUpcomingNotificationForCalendarEvent, getAllCalendarSelections, saveCalendarSelections } from '@/utils/database';
import { useT } from '@/utils/i18n';
import { logger, makeLogHeader } from '@/utils/logger';
import { getPermissionInstructions } from '@/utils/permissions';

const LOG_FILE = 'app/(tabs)/calendar.tsx';

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
  isRecurring?: boolean;
  recurrenceRule?: Calendar.RecurrenceRule | null;
};

export default function CalendarScreen() {
  const [calendars, setCalendars] = useState<Calendar.Calendar[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [animations] = useState<Map<string, Animated.Value>>(new Map());
  const [drawerHeights] = useState<Map<string, number>>(new Map());
  const [buttonHeights] = useState<Map<string, number>>(new Map());
  const [drawerHeightUpdateTrigger, setDrawerHeightUpdateTrigger] = useState(0);
  const [hiddenEventIds, setHiddenEventIds] = useState<Set<string>>(new Set());
  const [showCalendarSelection, setShowCalendarSelection] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const t = useT();
  const insets = useSafeAreaInsets();
  
  // Calculate bottom padding for calendar list to account for bottom navigation bar
  // Tab bar height: Android button nav = 113px, Android gesture nav = 80px, iOS = ~80-90px
  // Add safe area bottom inset plus tab bar height
  const isButtonNavigation = Platform.OS === 'android' && insets.bottom >= 16;
  const tabBarHeight = Platform.OS === 'android' 
    ? (isButtonNavigation ? 113 : 80)
    : 80; // iOS default
  const calendarListBottomPadding = tabBarHeight + insets.bottom + 20; // Extra 20px for comfortable spacing

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
          logger.info(makeLogHeader(LOG_FILE, 'initCalendar'), 'Permission check timed out, requesting directly...');
          await requestCalendarPermissions();
        }
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'initCalendar'), 'Error initializing calendar:', error);
        if (mounted) {
          // On error, try requesting permission directly
          try {
            await requestCalendarPermissions();
          } catch (requestError) {
            logger.error(makeLogHeader(LOG_FILE, 'initCalendar'), 'Request also failed:', requestError);
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
      // Check calendar permissions when tab is focused
      (async () => {
        try {
          const { status } = await Calendar.getCalendarPermissionsAsync();
          if (status === 'denied') {
            Alert.alert(
              t('alertTitles.calendarPermissionRequired'),
              getPermissionInstructions('calendar'),
              [{ text: t('buttonText.ok') }]
            );
          }
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to check calendar permissions:', error);
        }
      })();

      if (calendars.length > 0 && selectedCalendarIds.size > 0) {
        loadEvents();
      }

      // Check for calendar event changes when Calendar screen is focused
      // Delay to avoid blocking UI
      setTimeout(() => {
        checkCalendarEventChanges().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to check calendar changes:', error);
        });
      }, 1000);
    }, [selectedCalendarIds, calendars])
  );

  const checkCalendarPermissions = async () => {
    try {
      // Check if Calendar module is available
      if (!Calendar || typeof Calendar.getCalendarPermissionsAsync !== 'function') {
        logger.error(makeLogHeader(LOG_FILE, 'checkCalendarPermissions'), 'Calendar module not available');
        setPermissionStatus('denied');
        return;
      }

      logger.info(makeLogHeader(LOG_FILE, 'checkCalendarPermissions'), 'Checking calendar permissions...');
      const { status } = await Calendar.getCalendarPermissionsAsync();
      logger.info(makeLogHeader(LOG_FILE, 'checkCalendarPermissions'), 'Calendar permission status:', status);

      setPermissionStatus(status as 'granted' | 'denied' | 'undetermined');

      if (status === 'granted') {
        await loadCalendars();
      } else if (status === 'undetermined') {
        // If undetermined, automatically request permission
        logger.info(makeLogHeader(LOG_FILE, 'checkCalendarPermissions'), 'Permission undetermined, requesting...');
        await requestCalendarPermissions();
      }
    } catch (error: any) {
      logger.error(makeLogHeader(LOG_FILE, 'checkCalendarPermissions'), 'Failed to check calendar permissions:', error);
      // Handle MissingCalendarPListValueException gracefully
      if (error?.message?.includes('MissingCalendarPListValueException') ||
        error?.code === 'MissingCalendarPListValueException') {
        setPermissionStatus('denied');
        Alert.alert(
          t('alertTitles.configurationRequired'),
          t('alertMessages.configurationRequired'),
          [{ text: t('buttonText.ok') }]
        );
      } else {
        // For other errors, try requesting permission directly
        logger.info(makeLogHeader(LOG_FILE, 'checkCalendarPermissions'), 'Error checking permissions, trying to request directly...');
        setPermissionStatus('undetermined');
        // Try requesting permission as fallback
        try {
          await requestCalendarPermissions();
        } catch (requestError) {
          logger.error(makeLogHeader(LOG_FILE, 'checkCalendarPermissions'), 'Failed to request permissions:', requestError);
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
          t('alertTitles.permissionRequired'),
          t('alertMessages.permissionRequired'),
          [
            { text: t('buttonText.cancel'), style: 'cancel' },
            {
              text: t('alertTitles.settings'), onPress: () => {
                // On iOS, we can't directly open settings, but the user can do it manually
                Alert.alert(t('alertTitles.settings'), t('alertMessages.settingsInstructions'));
              }
            }
          ]
        );
      }
    } catch (error: any) {
      logger.error(makeLogHeader(LOG_FILE, 'requestCalendarPermissions'), 'Failed to request calendar permissions:', error);
      // Don't show alert on MissingCalendarPListValueException - it's a configuration issue
      if (error?.message?.includes('MissingCalendarPListValueException')) {
        Alert.alert(
          t('alertTitles.configurationError'),
          t('alertMessages.configurationError')
        );
      } else {
        Alert.alert(t('alertTitles.error'), t('alertMessages.failedToRequestCalendarPermissions'));
      }
      setPermissionStatus('denied');
    }
  };

  const loadCalendars = async () => {
    try {
      const calendarsList = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      setCalendars(calendarsList);

      // Load saved calendar selections from database (both selected and unselected)
      const savedSelections = await getAllCalendarSelections();

      // If we have any saved selections, use them
      if (savedSelections.size > 0) {
        // Build set of selected calendar IDs from saved selections
        // Only include calendars that still exist (in case calendars were deleted)
        const validSelectedIds = new Set(
          Array.from(savedSelections.entries())
            .filter(([calendarId, isSelected]) =>
              isSelected && calendarsList.some(cal => cal.id === calendarId)
            )
            .map(([calendarId]) => calendarId)
        );

        setSelectedCalendarIds(validSelectedIds);

        // Clean up database: remove selections for calendars that no longer exist
        // and ensure new calendars are tracked (they'll be unselected by default)
        // This is handled by saveCalendarSelections which updates all calendars
        await saveCalendarSelections(validSelectedIds);
      } else {
        // No saved selections at all, select all calendars by default
        const defaultSelected = new Set(calendarsList.map(cal => cal.id));
        setSelectedCalendarIds(defaultSelected);
        // Save the default selection
        await saveCalendarSelections(defaultSelected);
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'loadCalendars'), 'Failed to load calendars:', error);
      Alert.alert(t('alertTitles.error'), t('alertMessages.failedToLoadCalendars'));
    }
  };

  const toggleCalendarSelection = async (calendarId: string) => {
    const newSelected = new Set(selectedCalendarIds);
    if (newSelected.has(calendarId)) {
      newSelected.delete(calendarId);
    } else {
      newSelected.add(calendarId);
    }
    setSelectedCalendarIds(newSelected);

    // Save the updated selection state to database
    try {
      await saveCalendarSelections(newSelected);
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'toggleCalendarSelection'), 'Failed to save calendar selection:', error);
    }
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
              isRecurring: event.recurrenceRule !== null && event.recurrenceRule !== undefined,
              recurrenceRule: event.recurrenceRule || undefined,
            });
          }
        } catch (error) {
          logger.error(makeLogHeader(LOG_FILE, 'loadEvents'), `Failed to load events for calendar ${calendarId}:`, error);
        }
      }

      // Remove duplicates based on ID and log if duplicates found
      const uniqueEventsMap = new Map<string, CalendarEvent>();
      const duplicateIds: string[] = [];
      for (const event of allEvents) {
        if (uniqueEventsMap.has(event.id)) {
          duplicateIds.push(event.id);
          // console.warn(`Duplicate event ID found: ${event.id}`);
        } else {
          uniqueEventsMap.set(event.id, event);
        }
      }
      const uniqueEvents = Array.from(uniqueEventsMap.values());

      if (duplicateIds.length > 0) {
        // console.warn(`Found ${duplicateIds.length} duplicate event IDs:`, duplicateIds);
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
      logger.error(makeLogHeader(LOG_FILE, 'loadEvents'), 'Failed to load events:', error);
      Alert.alert('Error', 'Failed to load calendar events');
    }
  };

  useEffect(() => {
    if (selectedCalendarIds.size > 0) {
      loadEvents();
    }
  }, [selectedCalendarIds]);

  const onRefresh = useCallback(async () => {
    if (selectedCalendarIds.size === 0) {
      return;
    }
    setRefreshing(true);
    try {
      await loadEvents();
      // Check for calendar event changes after refresh
      setTimeout(() => {
        checkCalendarEventChanges().catch((error) => {
          logger.error(makeLogHeader(LOG_FILE, 'onRefresh'), 'Failed to check calendar changes:', error);
        });
      }, 500);
    } finally {
      setRefreshing(false);
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

  // Map calendar recurrence frequency to repeat option
  const mapRecurrenceToRepeatOption = (recurrenceRule: Calendar.RecurrenceRule | null | undefined): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' => {
    if (!recurrenceRule) {
      return 'none';
    }

    // Handle string format (iCal format like "FREQ=DAILY") - check this first
    // Use type assertion since Calendar.RecurrenceRule may not include string in its type definition
    if (typeof recurrenceRule === 'string') {
      const ruleStr = (recurrenceRule as string).toUpperCase();
      if (ruleStr.includes('FREQ=DAILY') || ruleStr.includes('FREQ=DAY')) return 'daily';
      if (ruleStr.includes('FREQ=WEEKLY') || ruleStr.includes('FREQ=WEEK')) return 'weekly';
      if (ruleStr.includes('FREQ=MONTHLY') || ruleStr.includes('FREQ=MONTH')) return 'monthly';
      if (ruleStr.includes('FREQ=YEARLY') || ruleStr.includes('FREQ=YEAR')) return 'yearly';
    }

    // Handle object format (expo-calendar may return an object)
    if (typeof recurrenceRule === 'object' && recurrenceRule !== null && 'frequency' in recurrenceRule) {
      const frequency = (recurrenceRule as any).frequency?.toLowerCase();
      if (frequency === 'daily') return 'daily';
      if (frequency === 'weekly') return 'weekly';
      if (frequency === 'monthly') return 'monthly';
      if (frequency === 'yearly' || frequency === 'year') return 'yearly';
    }

    return 'none';
  };

  const handleScheduleNotification = async (event: CalendarEvent) => {
    // Check if there's an upcoming notification for this calendar event
    const hasUpcomingNotification = await checkUpcomingNotificationForCalendarEvent(event.calendarId, event.originalEventId);

    if (hasUpcomingNotification) {
      // Show alert asking if user wants to create another notification
      Alert.alert(
        t('alertTitles.existingNotification'),
        t('alertMessages.existingNotificationMessage'),
        [
          {
            text: t('buttonText.cancel'),
            style: 'cancel',
            onPress: () => {
              // Do nothing, remain on calendar screen
            },
          },
          {
            text: t('buttonText.ok'),
            onPress: () => {
              // Proceed with navigation
              navigateToScheduleScreen(event);
            },
          },
        ]
      );
    } else {
      // No upcoming notification, proceed normally
      navigateToScheduleScreen(event);
    }
  };

  const navigateToScheduleScreen = (event: CalendarEvent) => {
    // Store event details in a custom URL format that we can parse later
    // Format: thenotifier://calendar-event?eventId={eventId}&calendarId={calendarId}&startDate={startDate}
    // This allows us to retrieve the event and open it properly in the native calendar app
    const calendarLink = `thenotifier://calendar-event?eventId=${encodeURIComponent(event.originalEventId)}&calendarId=${encodeURIComponent(event.calendarId)}&startDate=${encodeURIComponent(event.startDate.toISOString())}`;

    // Map recurrence frequency to repeat option
    const repeatOption = event.isRecurring ? mapRecurrenceToRepeatOption(event.recurrenceRule) : 'none';

    // Navigate to the Schedule Notification screen with pre-populated data
    const params = {
      date: event.startDate.toISOString(),
      title: '📅 ' + event.calendarName,
      message: event.title,
      note: '(click the button to open your calendar)',
      link: calendarLink,
      repeat: repeatOption,
      calendarId: event.calendarId,
      originalEventId: event.originalEventId,
      location: event.location,
      originalEventTitle: event.title,
      originalEventStartDate: event.startDate.toISOString(),
      originalEventEndDate: event.endDate.toISOString(),
      originalEventLocation: event.location || undefined,
      originalEventRecurring: repeatOption,
    };

    router.push({
      pathname: '/schedule/[formId]' as any,
      params: {
        formId: event.originalEventId,
        ...params,
      },
    });
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

    // Get measured button height, fallback to 56px (accommodates larger text sizes)
    // Ensure minimum of 56px to account for text scaling that might not be captured in measurement
    const measuredButtonHeight = Math.max(buttonHeights.get(item.id) || 0, 56);

    // Calculate dynamic minimum height for drawer
    // paddingTop (16) + location height (if present) + marginTop (8) + buttonHeight (measured, min 56px) + paddingBottom (16)
    // For events without location, minimum is: 16 + 8 + 56 + 16 = 96px
    // For events with location, location height will be measured dynamically
    const DYNAMIC_MINIMUM_DRAWER_HEIGHT = 16 + 8 + measuredButtonHeight + 16;

    // Use dynamic minimum height as default fallback, otherwise use measured height
    const defaultFallbackHeight = DYNAMIC_MINIMUM_DRAWER_HEIGHT;
    const measuredHeight = drawerHeights.get(item.id) || defaultFallbackHeight;

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
      // The measured height already includes padding (16px top, 16px bottom)
      // For calendar events, enforce dynamic minimum height based on measured button height
      // to ensure buttons are fully visible even with large text sizes
      let finalHeight = height;

      // Always enforce minimum height to ensure button is fully visible
      const currentButtonHeight = buttonHeights.get(item.id);
      if (currentButtonHeight && currentButtonHeight > 0) {
        // Use measured button height to calculate minimum
        const dynamicMinimum = 16 + 8 + currentButtonHeight + 16;
        finalHeight = Math.max(height, dynamicMinimum);
      } else {
        // Button hasn't been measured yet, use fallback minimum
        finalHeight = Math.max(height, DYNAMIC_MINIMUM_DRAWER_HEIGHT);
      }

      // Store the height for use in animation
      const currentHeight = drawerHeights.get(item.id);
      if (currentHeight !== finalHeight) {
        drawerHeights.set(item.id, finalHeight);
        // Trigger re-render to update animation with new height
        setDrawerHeightUpdateTrigger(prev => prev + 1);
      }
    };

    return (
      <ThemedView style={[styles.eventItem, { borderColor: colors.icon + '40' }]}>
        <TouchableOpacity
          style={styles.eventHeader}
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.7}>
          <ThemedView style={styles.eventContent}>
            <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.calendarName}>
              {item.calendarName}
            </ThemedText>
            <ThemedText type="defaultSemiBold" maxFontSizeMultiplier={1.6} style={styles.title}>
              {item.title}
            </ThemedText>
            <ThemedView style={styles.dateTimeContainer}>
              <ThemedText maxFontSizeMultiplier={1.6} style={styles.dateTime}>
                {formatDateTime(item.startDate)}
              </ThemedText>
              {item.isRecurring && (
                <IconSymbol
                  name="repeat"
                  size={20}
                  color={colors.icon}
                  style={styles.recurringIcon}
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

            {item.location && (
              <ThemedView style={styles.detailRow}>
                <ThemedText type="subtitle" maxFontSizeMultiplier={1.6} style={styles.detailLabel}>
                  {t('detailLabels.location')}
                </ThemedText>
                <ThemedText
                  maxFontSizeMultiplier={1.6}
                  style={styles.detailValue}
                  numberOfLines={2}
                  ellipsizeMode="tail">
                  {item.location}
                </ThemedText>
              </ThemedView>
            )}

            <ThemedView style={styles.actionButtons}>
              {/* <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#bf3f2f' }]}
                onPress={() => handleHideEvent(item.id)}
                activeOpacity={0.7}>
                <ThemedText style={styles.actionButtonText}>Hide Event</ThemedText>
              </TouchableOpacity> */}

              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.tint }]}
                onPress={() => handleScheduleNotification(item)}
                activeOpacity={0.7}
                onLayout={(event) => {
                  const { height } = event.nativeEvent.layout;
                  // Store the measured button height to calculate dynamic minimum drawer height
                  // Measure the actual button height (not container) for accurate measurement
                  // Ensure minimum of 56px to account for text scaling
                  const measuredHeight = Math.max(height, 56);
                  const currentButtonHeight = buttonHeights.get(item.id);
                  // Only update if height is valid and different, or if we don't have a measurement yet
                  if (measuredHeight > 0 && currentButtonHeight !== measuredHeight) {
                    buttonHeights.set(item.id, measuredHeight);

                    // Immediately recalculate drawer height
                    const dynamicMinimum = 16 + 8 + measuredHeight + 16;
                    const currentDrawerHeight = drawerHeights.get(item.id);
                    // Always update if we don't have a drawer height, or if current is less than minimum
                    if (!currentDrawerHeight || currentDrawerHeight < dynamicMinimum) {
                      drawerHeights.set(item.id, dynamicMinimum);
                      // Trigger re-render to update drawer height calculation
                      setDrawerHeightUpdateTrigger(prev => prev + 1);
                    } else {
                      // Even if drawer height is already set, trigger re-render to ensure consistency
                      setDrawerHeightUpdateTrigger(prev => prev + 1);
                    }
                  }
                }}>
                <ThemedText maxFontSizeMultiplier={1.4} style={[styles.actionButtonText, { color: colors.buttonText }]}>{t('buttonText.scheduleNotification')}</ThemedText>
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
          <ThemedText type="title" maxFontSizeMultiplier={1.6}>{t('calendarScreen.calendarEvents')}</ThemedText>
        </ThemedView>
        <ThemedView style={styles.emptyContainer}>
          <ThemedText maxFontSizeMultiplier={1.6} style={styles.emptyText}>{t('emptyStates.checkingCalendarPermissions')}</ThemedText>
        </ThemedView>
      </ThemedView>
    );
  }

  if (permissionStatus === 'denied') {
    return (
      <ThemedView style={styles.container}>
        <ThemedView style={styles.header}>
          {/* <ThemedText type="title">Calendar Events</ThemedText> */}
        </ThemedView>
        <ThemedView style={styles.emptyContainer}>
          <ThemedText maxFontSizeMultiplier={1.6} style={styles.emptyText}>{t('emptyStates.permissionDenied')}</ThemedText>
          <TouchableOpacity
            style={[styles.calendarButton, { backgroundColor: '#499f5d', marginTop: 20 }]}
            onPress={requestCalendarPermissions}
            activeOpacity={0.7}>
            <ThemedText maxFontSizeMultiplier={1.6} style={styles.calendarButtonText}>{t('buttonText.requestCalendarAccess')}</ThemedText>
          </TouchableOpacity>
        </ThemedView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
        {/* <ThemedText type="title">Calendar Events</ThemedText> */}
        <TouchableOpacity
          // style={[styles.calendarButton]}
          style={[styles.calendarButton, { backgroundColor: colors.tint, borderColor: colors.icon + '40' }]}
          onPress={() => setShowCalendarSelection(!showCalendarSelection)}
          activeOpacity={0.7}>
          {/* <ThemedText style={styles.calendarButtonText}> */}
          <ThemedText
            maxFontSizeMultiplier={1.6}
            style={[styles.calendarButtonText, { color: colors.buttonText }]}>
            {showCalendarSelection ? t('buttonText.hideCalendarList') : t('buttonText.selectCalendars')}
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>

      {showCalendarSelection && (
        <ThemedView style={[styles.calendarSelection, { borderBottomColor: colors.icon + '40' }]}>
          {/* <ThemedText type="subtitle" style={styles.calendarSelectionTitle}>
            Select Calendars:
          </ThemedText> */}
          <FlatList
            data={calendars}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ThemedView style={[styles.calendarItem, { borderBottomColor: colors.icon + '20' }]}>
                <ThemedText maxFontSizeMultiplier={1.6} style={styles.calendarItemText}>{item.title}</ThemedText>
                <Switch
                  value={selectedCalendarIds.has(item.id)}
                  onValueChange={() => toggleCalendarSelection(item.id)}
                  trackColor={{ false: '#888', true: '#68CFAF' }}
                  thumbColor='#f0f0f0'
                />
              </ThemedView>
            )}
            // style={styles.calendarList}
            style={[{ backgroundColor: colors.background }]}
            contentContainerStyle={{ paddingBottom: calendarListBottomPadding }}
          />
        </ThemedView>
      )}

      {visibleEvents.length === 0 ? (
        <ThemedView style={styles.emptyContainer}>
          <ThemedText maxFontSizeMultiplier={1.6} style={styles.emptyText}>
            {selectedCalendarIds.size === 0
              ? t('emptyStates.selectCalendarsToViewEvents')
              : t('emptyStates.noEventsFound')}
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
          refreshing={refreshing}
          onRefresh={onRefresh}
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
    borderRadius: 50,
    alignItems: 'center',
    borderWidth: 1,
    // borderColor: Colors.light.icon + '40',
  },
  calendarButtonText: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  calendarSelection: {
    padding: 20,
    borderBottomWidth: 1,
    // maxHeight: 300,
    // backgroundColor: '#242424',
  },
  calendarSelectionTitle: {
    marginBottom: 12,
  },
  calendarList: {
    // backgroundColor: '#242424',
    // maxHeight: 200,
  },
  calendarItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    // borderBottomWidth: 1,
    // backgroundColor: '#242424',

  },
  calendarItemText: {
    fontSize: 18,
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
    fontSize: 14,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 18,
    marginBottom: 4,
  },
  dateTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateTime: {
    fontSize: 18,
    opacity: 0.8,
  },
  recurringIcon: {
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
    justifyContent: 'center',
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 50,
    width: '90%',
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
});

