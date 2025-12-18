import { useColorScheme as useRNColorScheme } from 'react-native';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getAppearanceMode, setAppearanceMode } from '@/utils/database';

type AppearanceMode = 'system' | 'light' | 'dark';

interface AppearanceContextType {
  mode: AppearanceMode;
  effectiveScheme: 'light' | 'dark';
  setMode: (mode: AppearanceMode) => Promise<void>;
}

export const AppearanceContext = createContext<AppearanceContextType | undefined>(undefined);

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error('useAppearance must be used within AppearanceProvider');
  }
  return context;
}

interface AppearanceProviderProps {
  children: ReactNode;
}

export function AppearanceProvider({ children }: AppearanceProviderProps) {
  const deviceScheme = useRNColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>('system');
  const [isLoading, setIsLoading] = useState(true);

  // Load appearance mode from database on mount
  useEffect(() => {
    const loadAppearanceMode = async () => {
      try {
        const savedMode = await getAppearanceMode();
        setModeState(savedMode);
      } catch (error) {
        console.error('Failed to load appearance mode:', error);
        setModeState('system'); // Default to system on error
      } finally {
        setIsLoading(false);
      }
    };

    loadAppearanceMode();
  }, []);

  // Compute effective scheme based on mode
  const effectiveScheme: 'light' | 'dark' = mode === 'system' 
    ? (deviceScheme ?? 'light')
    : mode;

  const handleSetMode = async (newMode: AppearanceMode) => {
    try {
      await setAppearanceMode(newMode);
      setModeState(newMode);
    } catch (error) {
      console.error('Failed to save appearance mode:', error);
      throw error;
    }
  };

  // Don't render children until we've loaded the mode to avoid flash
  if (isLoading) {
    return null;
  }

  return (
    <AppearanceContext.Provider
      value={{
        mode,
        effectiveScheme,
        setMode: handleSetMode,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}

