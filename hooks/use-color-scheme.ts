import { useColorScheme as useRNColorScheme } from 'react-native';
import { useContext } from 'react';
import { AppearanceContext } from '@/components/appearance-provider';

export function useColorScheme() {
  const appearanceContext = useContext(AppearanceContext);
  
  // If AppearanceProvider is present, use its effective scheme
  if (appearanceContext) {
    return appearanceContext.effectiveScheme;
  }
  
  // Fallback to device scheme if provider not available
  return useRNColorScheme() ?? 'light';
}
