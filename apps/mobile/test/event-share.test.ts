// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Linking: {}, Platform: { OS: 'web' }, Share: {} }));
const { eventShareText, gematria, hebrewDate } = await import('../src/lib/event-share');

describe('event sharing and the Hebrew date (phase 71c)', () => {
  it('gives the Hebrew calendar date', () => {
    // 31 October 2026 is 20 Heshvan 5787.
    expect(hebrewDate('2026-10-31T12:00:00Z', 'Asia/Jerusalem')).toBe('כ׳ בחשוון תשפ״ז');
    expect(hebrewDate('2027-03-15T12:00:00Z', 'Asia/Jerusalem')).toBe('ו׳ באדר ב׳ תשפ״ז');
  });

  it('writes numbers in Hebrew letters, 15 and 16 the traditional way', () => {
    expect(gematria(1)).toBe('א׳');
    expect(gematria(15)).toBe('ט״ו');
    expect(gematria(16)).toBe('ט״ז');
    expect(gematria(30)).toBe('ל׳');
    expect(gematria(5787)).toBe('תשפ״ז');
    expect(gematria(5800)).toBe('ת״ת');
  });

  it('returns null rather than a wrong date when the calendar is missing', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('no calendar');
    });
    expect(hebrewDate('2026-10-31T12:00:00Z')).toBeNull();
    spy.mockRestore();
  });

  it('shares the title, when, and the link only', () => {
    expect(eventShareText('Picnic', 'Sat 7 Nov, 17:00', 'https://x.test/events/1')).toBe(
      'Picnic\nSat 7 Nov, 17:00\nhttps://x.test/events/1',
    );
  });
});
