import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useT } from '@/utils/i18n';
import { openNotifierLink } from '@/utils/open-link';
import { logger, makeLogHeader } from '@/utils/logger';

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



  const { title, message, note, link } = useLocalSearchParams<{ title: string, message: string, note: string, link: string }>();
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'title', title);
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'message', message);
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'note', note);
  logger.info(makeLogHeader(LOG_FILE, 'NotificationDisplayScreen'), 'link', link);

  const handleOpenLink = async () => {
    if (!link) return;
    await openNotifierLink(link, t);
  };

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




