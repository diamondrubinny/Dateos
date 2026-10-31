// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Linking, Platform, Share } from 'react-native';
import { webUrl } from './config';

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/**
 * A number (1–999) in Hebrew letters, with a geresh or gershayim: 20 → כ׳, 15 → ט״ו (never the
 * divine name), 787 → תשפ״ז.
 */
export function gematria(n: number): string {
  let rest = n % 1000;
  let letters = '';
  while (rest >= 400) {
    letters += 'ת';
    rest -= 400;
  }
  letters += HUNDREDS[Math.floor(rest / 100)]!;
  rest %= 100;
  if (rest === 15 || rest === 16) {
    letters += rest === 15 ? 'טו' : 'טז';
  } else {
    letters += TENS[Math.floor(rest / 10)]! + ONES[rest % 10]!;
  }
  return letters.length === 1 ? `${letters}׳` : `${letters.slice(0, -1)}״${letters.slice(-1)}`;
}

/**
 * Phase 71c: the Hebrew calendar date ("כ׳ בחשוון תשפ״ז"), from the device's own calendar data, or
 * null where that calendar isn't available. ICU gives the day and year in digits; they're written
 * in Hebrew letters here. 📘 Intl calendars: https://tc39.es/ecma402/
 */
export function hebrewDate(iso: string, timeZone?: string): string | null {
  try {
    const format = new Intl.DateTimeFormat('he-u-ca-hebrew', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(timeZone ? { timeZone } : {}),
    });
    if (format.resolvedOptions().calendar !== 'hebrew') return null;
    const parts = format.formatToParts(new Date(iso));
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    const day = Number(part('day'));
    const year = Number(part('year'));
    const month = part('month');
    if (!day || !year || !month) return null;
    return `${gematria(day)} ב${month} ${gematria(year)}`;
  } catch {
    return null;
  }
}

export const eventUrl = (id: string) => `${webUrl()}/events/${id}`;

/** What a shared event says: the title, when, and the link (which needs signing in). */
export const eventShareText = (title: string, when: string, url: string) =>
  `${title}\n${when}\n${url}`;

/**
 * Shares an event through the device's share sheet (WhatsApp and others); on the web without one,
 * opens WhatsApp with the text. Nothing about who's going is shared.
 */
export async function shareEvent(text: string): Promise<'shared' | 'whatsapp' | 'failed'> {
  try {
    if (Platform.OS !== 'web') {
      await Share.share({ message: text });
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ text });
      return 'shared';
    }
    await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
    return 'whatsapp';
  } catch {
    return 'failed';
  }
}
