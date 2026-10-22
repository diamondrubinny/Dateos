// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { getLocales } from 'expo-localization';
import * as Updates from 'expo-updates';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DevSettings, I18nManager, Platform } from 'react-native';
import i18n, { isAppLocale, rtlLocales, type AppLocale } from '../i18n';
import { prefs } from './storage';

const PREF_KEY = 'nexaheart.locale';

interface LocaleState {
  locale: AppLocale;
  direction: 'rtl' | 'ltr';
  setLocale: (locale: AppLocale) => Promise<void>;
}

const LocaleContext = createContext<LocaleState | null>(null);

function deviceLocale(): AppLocale {
  const code = getLocales()[0]?.languageCode;
  return isAppLocale(code) ? code : 'he';
}

function applyWebDocument(locale: AppLocale) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = rtlLocales.has(locale) ? 'rtl' : 'ltr';
}

/**
 * Native layout direction can only change on reload (I18nManager), so switching between
 * Hebrew and English restarts the JS bundle there. On the web it switches instantly.
 */
async function applyNativeDirection(locale: AppLocale): Promise<void> {
  if (Platform.OS === 'web') return;
  const rtl = rtlLocales.has(locale);
  if (I18nManager.isRTL === rtl) return;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  if (__DEV__) DevSettings.reload();
  else await Updates.reloadAsync();
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(deviceLocale);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void prefs.get(PREF_KEY).then(async (stored) => {
      const next = isAppLocale(stored) ? stored : deviceLocale();
      await i18n.changeLanguage(next);
      applyWebDocument(next);
      if (!cancelled) {
        setLocaleState(next);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback(async (next: AppLocale) => {
    await prefs.set(PREF_KEY, next);
    await i18n.changeLanguage(next);
    applyWebDocument(next);
    setLocaleState(next);
    await applyNativeDirection(next);
  }, []);

  const value = useMemo<LocaleState>(
    () => ({ locale, direction: rtlLocales.has(locale) ? 'rtl' : 'ltr', setLocale }),
    [locale, setLocale],
  );

  if (!ready) return null;
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}
