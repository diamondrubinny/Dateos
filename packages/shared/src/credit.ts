// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * The "Powered by NexaHeart" credit (phase 17). Keeping it visible is an additional term of the
 * license (AGPL-3.0 section 7(b), see NOTICE): every user interface and every email shows it,
 * whatever name and logo a community chooses. `scripts/check-credit.mjs` fails CI without it.
 */
export const CREDIT_NAME = 'NexaHeart';
export const CREDIT_URL = 'https://nexaheart.com';
/** In emails: the address without a scheme, so a safety alert still carries no link. */
export const CREDIT_DOMAIN = 'nexaheart.com';
export const CREDIT_LICENSE = 'AGPL-3.0-or-later';
/** Who created NexaHeart (phase 29): shown next to the credit in every app and the dashboard. */
export const CREDIT_AUTHOR = 'Diamond Rubinny';
export const CREDIT_AUTHOR_URL = 'https://github.com/diamondrubinny';
/** Where "Open source" points by default; a modified version must point to its own source. */
export const UPSTREAM_SOURCE_URL = 'https://github.com/diamondrubinny/Dateos';

export const creditLocales = ['en', 'he', 'ar', 'ru'] as const;
export type CreditLocale = (typeof creditLocales)[number];

/** The two parts of the credit; each links somewhere (the project site, then the source). */
export interface CreditText {
  poweredBy: string;
  openSource: string;
  /** "Created by Diamond Rubinny" (phase 29). */
  createdBy: string;
}

export const CREDIT_TEXT: Record<CreditLocale, CreditText> = {
  en: {
    poweredBy: 'Powered by NexaHeart',
    openSource: 'Open source',
    createdBy: `Created by ${CREDIT_AUTHOR}`,
  },
  he: {
    poweredBy: 'מופעל על ידי NexaHeart',
    openSource: 'קוד פתוח',
    createdBy: `נוצר על ידי ${CREDIT_AUTHOR}`,
  },
  ar: {
    poweredBy: 'يعمل بواسطة NexaHeart',
    openSource: 'مفتوح المصدر',
    createdBy: `من إنشاء ${CREDIT_AUTHOR}`,
  },
  ru: {
    poweredBy: 'Работает на NexaHeart',
    openSource: 'Открытый исходный код',
    createdBy: `Создано: ${CREDIT_AUTHOR}`,
  },
};

export function creditText(locale: string): CreditText {
  const base = locale.split('-')[0] as CreditLocale;
  return CREDIT_TEXT[creditLocales.includes(base) ? base : 'en'];
}

/** One line for plain-text emails and logs: "Powered by NexaHeart · Open source · nexaheart.com". */
export function creditLine(locale = 'en'): string {
  const text = creditText(locale);
  return `${text.poweredBy} · ${text.openSource} · ${CREDIT_DOMAIN}`;
}

/**
 * The same line for HTML emails. Plain text, not a link: emails keep their only link the one the
 * reader expects (or none, for safety alerts), so the credit never looks like phishing.
 */
export function creditHtml(locale = 'en'): string {
  const dir = locale.startsWith('he') || locale.startsWith('ar') ? 'rtl' : 'ltr';
  return `<p dir="${dir}" style="font-size:12px;color:#6B7280">${creditLine(locale)}</p>`;
}
