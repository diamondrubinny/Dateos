import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { he } from './he';

export const locales = ['he', 'en'] as const;
export type AppLocale = (typeof locales)[number];
export const rtlLocales: ReadonlySet<AppLocale> = new Set(['he']);

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, he: { translation: he } },
  lng: 'he',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes rendered text
  returnNull: false,
});

export default i18n;
