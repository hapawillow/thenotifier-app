import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useT } from '@/utils/i18n';
import { logger, makeLogHeader } from '@/utils/logger';
import { openNotifierLink } from '@/utils/open-link';
import { useNavigation } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { NativeAlarmManager } from 'notifier-alarm-manager';
import { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';

const LOG_FILE = 'app/notification-display.tsx';

export default function NotificationDisplayScreen() {

  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'NotificationDisplayScreen');

  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const t = useT();
  const navigation = useNavigation();
  const closeButtonStyle = useMemo(() => [
    styles.closeButton,
    { backgroundColor: colors.tint }
  ], [colors.tint]);
  const closeButtonTextStyle = useMemo(() => [
    styles.closeButtonText,
    { color: colors.buttonText }
  ], [colors.buttonText]);
  const linkButtonStyle = useMemo(() => [
    styles.linkButton,
    { borderColor: colors.tint }
  ], [colors.tint]);
  const linkButtonTextStyle = useMemo(() => [
    styles.linkButtonText,
    { color: colors.tint }
  ], [colors.tint]);



  const { title, message, note, link: rawLink, alarmId } = useLocalSearchParams<{ title: string, message: string, note: string, link: string, alarmId: string }>();
  
  // Decode the link parameter - it may be URL-encoded when passed through deep link query parameters
  // expo-router should decode it, but we'll ensure it's decoded here as a safeguard
  const link = useMemo(() => {
    if (!rawLink) return rawLink;
    try {
      // Check if link appears to be URL-encoded
      if (rawLink.includes('%')) {
        const decoded = decodeURIComponent(rawLink);
        logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), `Decoded link parameter: ${rawLink} -> ${decoded}`);
        return decoded;
      }
      return rawLink;
    } catch (e) {
      logger.error(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'Failed to decode link parameter, using original:', e);
      return rawLink;
    }
  }, [rawLink]);
  
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'title', title);
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'message', message);
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'note', note);
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'link (raw):', rawLink);
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'link (decoded):', link);
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'alarmId', alarmId);

  const handleOpenLink = async () => {
    if (!link) {
      logger.info(makeLogHeader(LOG_FILE, 'handleOpenLink'), 'No link provided');
      return;
    }
    
    // Check if link is incomplete (only has eventId, missing calendarId and startDate)
    // This can happen when the link was stored incompletely in the database
    let completeLink = link;
    if (link.startsWith('thenotifier://calendar-event')) {
      try {
        const url = new URL(link);
        const eventId = url.searchParams.get('eventId');
        const calendarId = url.searchParams.get('calendarId');
        const startDate = url.searchParams.get('startDate');
        
        // If link is incomplete and we have alarmId, fetch missing data from database
        if (eventId && (!calendarId || !startDate) && alarmId) {
          logger.info(makeLogHeader(LOG_FILE, 'handleOpenLink'), 
            `Link is incomplete - eventId: ${eventId}, calendarId: ${calendarId || 'MISSING'}, startDate: ${startDate || 'MISSING'}. Fetching from database using alarmId: ${alarmId}`);
          
          try {
            const { getNotificationIdFromAlarmId, getScheduledNotificationData, getArchivedNotificationData } = await import('@/utils/database');
            
            // Get notificationId from alarmId
            const notificationId = await getNotificationIdFromAlarmId(alarmId);
            if (!notificationId) {
              logger.error(makeLogHeader(LOG_FILE, 'handleOpenLink'), `Could not find notificationId for alarmId: ${alarmId}`);
              // Continue with incomplete link - openNotifierLink will handle the error
            } else {
              // Fetch notification data - try scheduled first, then archived
              let notificationLink: string | null = null;
              let isArchived = false;
              
              const scheduledNotification = await getScheduledNotificationData(notificationId);
              if (scheduledNotification?.link) {
                notificationLink = scheduledNotification.link;
              } else {
                const archivedNotification = await getArchivedNotificationData(notificationId);
                if (archivedNotification?.link) {
                  notificationLink = archivedNotification.link;
                  isArchived = true;
                }
              }
              
              if (notificationLink && notificationLink.startsWith('thenotifier://calendar-event')) {
                try {
                  const notificationLinkUrl = new URL(notificationLink);
                  const notificationEventId = notificationLinkUrl.searchParams.get('eventId');
                  const notificationCalendarId = notificationLinkUrl.searchParams.get('calendarId');
                  const notificationStartDate = notificationLinkUrl.searchParams.get('startDate');
                  
                  // Verify the eventId matches and the link is complete
                  if (notificationEventId === eventId && notificationCalendarId && notificationStartDate) {
                    completeLink = notificationLink;
                    logger.info(makeLogHeader(LOG_FILE, 'handleOpenLink'), 
                      `Using complete link from ${isArchived ? 'archived' : 'scheduled'} notification: ${completeLink}`);
                  } else {
                    logger.error(makeLogHeader(LOG_FILE, 'handleOpenLink'), 
                      `Notification link is incomplete or eventId mismatch - eventId: ${notificationEventId}, calendarId: ${notificationCalendarId || 'MISSING'}, startDate: ${notificationStartDate || 'MISSING'}`);
                  }
                } catch (linkError) {
                  logger.error(makeLogHeader(LOG_FILE, 'handleOpenLink'), 'Failed to parse notification link:', linkError);
                }
              } else {
                logger.error(makeLogHeader(LOG_FILE, 'handleOpenLink'), 
                  `Notification not found or has no link - notificationId: ${notificationId}`);
              }
            }
          } catch (dbError) {
            logger.error(makeLogHeader(LOG_FILE, 'handleOpenLink'), 'Failed to fetch notification data from database:', dbError);
            // Continue with incomplete link - openNotifierLink will handle the error
          }
        }
      } catch (urlError) {
        logger.error(makeLogHeader(LOG_FILE, 'handleOpenLink'), 'Failed to parse link URL:', urlError);
        // Continue with original link
      }
    }
    
    await openNotifierLink(completeLink, t);
  };

  // Android: Stop alarm sound, dismiss notification banner, and clean up storage
  useEffect(() => {
    if (Platform.OS === 'android' && alarmId) {
      logger.info(makeLogHeader(LOG_FILE, 'useEffect'), 'Calling stopAlarmSoundAndDismiss for alarmId:', alarmId);
      NativeAlarmManager.stopAlarmSoundAndDismiss?.(alarmId).catch((error) => {
        logger.error(makeLogHeader(LOG_FILE, 'useEffect'), 'Failed to stop alarm sound/dismiss notification:', error);
      });

      // Determine if this is a daily alarm instance or one-time alarm and clean up
      // Use a fire-and-forget approach to prevent any errors from affecting the UI
      (async () => {
        try {
          const { markDailyAlarmInstanceFired, isDailyAlarmInstance } = await import('@/utils/database');

          // Check if this alarmId exists in dailyAlarmInstance table
          const isDailyInstance = await isDailyAlarmInstance(alarmId);

          if (isDailyInstance) {
            // Daily repeat alarm: mark as fired in DB
            try {
              await markDailyAlarmInstanceFired(alarmId);
              logger.info(makeLogHeader(LOG_FILE, 'useEffect'), `Marked daily alarm instance as fired: ${alarmId}`);
            } catch (markError) {
              // Log but continue - we'll still clean up native storage
              logger.error(makeLogHeader(LOG_FILE, 'useEffect'), `Failed to mark daily alarm instance as fired: ${alarmId}`, markError);
            }
          } else {
            // One-time alarm: just log (no DB entry to update)
            logger.info(makeLogHeader(LOG_FILE, 'useEffect'), `One-time alarm fired: ${alarmId}`);
          }

          // Clean up native storage for both types using cancelAlarm (more reliable)
          // cancelAlarm handles both AlarmManager cancellation and storage deletion
          // For already-fired alarms, cancelling is safe (no-op if already fired)
          try {
            await NativeAlarmManager.cancelAlarm(alarmId);
            logger.info(makeLogHeader(LOG_FILE, 'useEffect'), `Cleaned up alarm from native storage: ${alarmId}`);
          } catch (cancelError) {
            const errorMessage = cancelError instanceof Error ? cancelError.message : String(cancelError);
            // Don't log "not found" errors - alarm may have already been cleaned up
            if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
              // Log but don't throw - native cleanup failure shouldn't crash the screen
              logger.error(makeLogHeader(LOG_FILE, 'useEffect'), `Failed to clean up alarm from native storage: ${alarmId}`, cancelError);
            } else {
              logger.info(makeLogHeader(LOG_FILE, 'useEffect'), `Alarm already cleaned up: ${alarmId}`);
            }
          }
        } catch (error) {
          // Log error but don't throw - we don't want to crash the screen
          // This catch is for any unexpected errors in the async flow
          logger.error(makeLogHeader(LOG_FILE, 'useEffect'), 'Unexpected error in alarm cleanup:', error);
        }
      })(); // Fire and forget - don't await or catch here to prevent any navigation issues
    }
  }, [alarmId]);

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.content}>
        <ThemedView style={styles.messageContainer}>
          <ThemedText type="title" maxFontSizeMultiplier={1.6} style={styles.title}>{title}</ThemedText>
          <ThemedText type="message" maxFontSizeMultiplier={1.6} style={styles.message}>{message}</ThemedText>
          {note && (
            <>
              <ThemedText type="subtitle" maxFontSizeMultiplier={1.6}>{t('notificationDisplay.note')}</ThemedText>
              <ThemedText maxFontSizeMultiplier={1.6} style={styles.note} selectable>{note}</ThemedText>
            </>
          )
          }
          {
            link && (
              <TouchableOpacity
                style={linkButtonStyle}
                onPress={handleOpenLink}>
                <ThemedText maxFontSizeMultiplier={1.6} style={linkButtonTextStyle}>
                  {link.startsWith('thenotifier://calendar-event') ? t('buttonText.openCalendarEvent') : t('buttonText.openLink')}
                </ThemedText>
              </TouchableOpacity >
            )
          }
        </ThemedView >
        <TouchableOpacity style={closeButtonStyle} onPress={() => {
          // If we can go back, do so. Otherwise navigate to home screen.
          // This handles the case where the screen was opened via deep link (no history).
          if (navigation.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)');
          }
        }}>
          <ThemedText type="link" maxFontSizeMultiplier={1.6} style={closeButtonTextStyle}>
            {t('buttonText.close')}
          </ThemedText>
        </TouchableOpacity >
      </ThemedView >
    </ThemedView >
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
    textAlign: 'left',
    marginBottom: 14,
  },
  note: {
    fontSize: 18,
    lineHeight: 24,
  },
  closeButton: {
    borderRadius: 50,
    padding: 16,
    alignItems: 'center',
    marginTop: 30,
  },
  closeButtonText: {
    textAlign: 'center',
  },
  linkButton: {
    borderRadius: 50,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    marginTop: 30,
  },
  linkButtonText: {
    textAlign: 'center',
    fontWeight: '600',
  },

});




