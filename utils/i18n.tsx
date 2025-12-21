import { getLanguagePack } from '@/assets/lang';
import React, { createContext, useContext, useMemo } from 'react';

type LanguagePack = {
  [key: string]: any;
};

type I18nContextType = {
  lang: string;
  version: string;
  pack: LanguagePack;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextType | null>(null);

type I18nProviderProps = {
  lang: string;
  version: string;
  pack: LanguagePack;
  children: React.ReactNode;
};

/**
 * Translates a nested key path (e.g., "buttonText.delete") to its value
 * Supports placeholder substitution with {{placeholder}} syntax
 */
export function translate(
  pack: LanguagePack,
  key: string,
  params?: Record<string, string | number>
): string {
  // Split the key by dots to navigate nested objects
  const keys = key.split('.');
  let value: any = pack;

  // Navigate through nested object structure
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Key not found, return the key itself (with optional dev logging)
      if (__DEV__) {
        console.warn(`[i18n] Translation key not found: ${key}`);
      }
      return key;
    }
  }

  // If value is not a string, return the key
  if (typeof value !== 'string') {
    if (__DEV__) {
      console.warn(`[i18n] Translation value is not a string for key: ${key}`);
    }
    return key;
  }

  // Replace placeholders with params
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (match, placeholder) => {
      return params[placeholder] !== undefined ? String(params[placeholder]) : match;
    });
  }

  return value;
}

/**
 * I18n Provider component that wraps the app and provides translation context
 */
export function I18nProvider({ lang, version, pack, children }: I18nProviderProps) {
  const t = useMemo(
    () => (key: string, params?: Record<string, string | number>) => translate(pack, key, params),
    [pack]
  );

  const value = useMemo(
    () => ({
      lang,
      version,
      pack,
      t,
    }),
    [lang, version, pack, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Hook to access translation function
 * @returns Translation function `t(key, params?)`
 */
export function useT() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useT must be used within I18nProvider');
  }
  return context.t;
}

/**
 * Initialize i18n system
 * Loads language pack based on language and version
 */
export async function initI18n(lang: string, version: string): Promise<LanguagePack> {
  return getLanguagePack(lang, version);
}

