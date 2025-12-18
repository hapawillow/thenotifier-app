import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { openNotifierLink } from '@/utils/open-link';

export default function AboutScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  // Get app version from Expo config
  const appVersion = Constants.expoConfig?.version || ' ';

  const handleTermsPress = async () => {
    await openNotifierLink('https://www.hapawillow.com/');
  };

  const handlePrivacyPress = async () => {
    await openNotifierLink('https://www.hapawillow.com/');
  };

  return (
    <ThemedView style={styles.container}>
      {/* Center section with icon and text */}
      <ThemedView style={styles.centerSection}>
        <Image
          source={require('../../assets/images/app-icon-1024x1024.png')}
          style={styles.appIcon}
          contentFit="contain"
        />
        <ThemedText maxFontSizeMultiplier={1.6} style={[styles.appName, { color: colors.text }]}>
          The Notifier
        </ThemedText>
        <ThemedText maxFontSizeMultiplier={1.6} style={[styles.appVersion, { color: colors.text }]}>
          {appVersion}
        </ThemedText>
      </ThemedView>

      {/* Bottom section with buttons */}
      <ThemedView style={[styles.bottomSection, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity
          style={[styles.button, { borderColor: colors.tint }]}
          onPress={handleTermsPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Terms & Conditions">
          <ThemedText maxFontSizeMultiplier={1.6} style={[styles.buttonText, { color: colors.tint }]}>
            Terms & Conditions
          </ThemedText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { borderColor: colors.tint }]}
          onPress={handlePrivacyPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Privacy Policy">
          <ThemedText maxFontSizeMultiplier={1.6} style={[styles.buttonText, { color: colors.tint }]}>
            Privacy Policy
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -30 }], // Position slightly above center
  },
  appIcon: {
    width: 150,
    height: 150,
    marginBottom: 20,
  },
  appName: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  appVersion: {
    fontSize: 18,
    fontWeight: 'normal',
    textAlign: 'center',
  },
  bottomSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 20,
  },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
  },
});

