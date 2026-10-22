// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar } from './ar';
import { en } from './en';
import { he } from './he';
import { ru } from './ru';

export const locales = ['he', 'en', 'ar', 'ru'] as const;
export type AppLocale = (typeof locales)[number];
export const rtlLocales: ReadonlySet<AppLocale> = new Set(['he', 'ar']);

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
    ar: { translation: ar },
    ru: { translation: ru },
  },
  lng: 'he',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes rendered text
  returnNull: false,
});

export default i18n;
