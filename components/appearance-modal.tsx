import { Modal, Platform, Pressable, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppearance } from '@/components/appearance-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppearanceMode = 'system' | 'light' | 'dark';

interface AppearanceModalProps {
  visible: boolean;
  onClose: () => void;
}

const APPEARANCE_MODES: Array<{ mode: AppearanceMode; label: string; icon: string }> = [
  { mode: 'dark', label: 'Dark mode', icon: 'moon.fill' },
  { mode: 'light', label: 'Light mode', icon: 'sun.max.fill' },
  { mode: 'system', label: 'Match device mode', icon: 'circle.lefthalf.filled' },
];

export function AppearanceModal({ visible, onClose }: AppearanceModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const appearance = useAppearance();

  const handleModeSelect = async (mode: AppearanceMode) => {
    try {
      await appearance.setMode(mode);
    } catch (error) {
      console.error('Failed to set appearance mode:', error);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <ThemedView
          style={[styles.modalCard, { backgroundColor: colors.background, borderColor: colors.icon + '40' }]}
          onStartShouldSetResponder={() => true}
        >
          <ThemedText type="title" style={styles.title}>
            Appearance
          </ThemedText>

          {APPEARANCE_MODES.map((item, index) => {
            const isSelected = appearance.mode === item.mode;
            return (
              <TouchableOpacity
                key={item.mode}
                onPress={() => handleModeSelect(item.mode)}
                activeOpacity={0.7}
                style={[
                  styles.modeItem,
                  isSelected && { backgroundColor: colors.tint + '20' },
                  index < APPEARANCE_MODES.length - 1 && { borderBottomColor: colors.icon + '20' },
                ]}
              >
                <IconSymbol
                  name={item.icon as any}
                  size={24}
                  color={isSelected ? colors.tint : colors.icon}
                  style={styles.modeIcon}
                />
                <ThemedText
                  maxFontSizeMultiplier={1.4}
                  style={[
                    styles.modeText,
                    isSelected && { color: colors.tint, fontWeight: '600' },
                  ]}
                >
                  {item.label}
                </ThemedText>
                {isSelected && (
                  <IconSymbol
                    name="checkmark"
                    size={20}
                    color={colors.tint}
                    style={styles.checkIcon}
                  />
                )}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.7}
            style={[styles.okButton, { backgroundColor: colors.tint }]}
          >
            <ThemedText maxFontSizeMultiplier={1.4} style={[styles.okButtonText, { color: colors.buttonText }]}>
              OK
            </ThemedText>
          </TouchableOpacity>
        </ThemedView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  title: {
    marginBottom: 20,
    textAlign: 'center',
  },
  modeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  modeIcon: {
    marginRight: 12,
  },
  modeText: {
    flex: 1,
    fontSize: 18,
  },
  checkIcon: {
    marginLeft: 8,
  },
  okButton: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  okButtonText: {
    fontSize: 18,
    fontWeight: '600',
  },
});

