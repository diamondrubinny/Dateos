// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { currentRest, restDay, restWindows, sunBelow } from '../src/index.js';

const day = (s: string) => Date.parse(`${s}T00:00:00Z`);
const at = (s: string) => Date.parse(s);
const localDay = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(ms));
const minutesOff = (a: number | null, b: string) => Math.abs((a ?? 0) - at(b)) / 60_000;
const JERUSALEM = [31.778, 35.235] as const;
const NEW_YORK = [40.713, -74.006] as const;

describe('sunset and nightfall (phase 74a) 📘', () => {
  it('match published sunset times within 2 minutes', () => {
    // Published: Jerusalem 19:47 IDT on 19 June, 16:38 IST on 18 December; New York 20:30 EDT
    // and 16:30 EST on the same days.
    expect(
      minutesOff(sunBelow(day('2026-06-19'), ...JERUSALEM, 0.833), '2026-06-19T19:47:00+03:00'),
    ).toBeLessThan(2);
    expect(
      minutesOff(sunBelow(day('2026-12-18'), ...JERUSALEM, 0.833), '2026-12-18T16:38:00+02:00'),
    ).toBeLessThan(2);
    expect(
      minutesOff(sunBelow(day('2026-06-19'), ...NEW_YORK, 0.833), '2026-06-19T20:30:00-04:00'),
    ).toBeLessThan(2);
    expect(
      minutesOff(sunBelow(day('2026-12-18'), ...NEW_YORK, 0.833), '2026-12-18T16:30:00-05:00'),
    ).toBeLessThan(2);
  });

  it('nightfall comes 35 to 55 minutes after sunset at these latitudes', () => {
    for (const [lat, lng] of [JERUSALEM, NEW_YORK]) {
      for (const d of ['2026-03-20', '2026-06-19', '2026-12-18']) {
        const gap =
          (sunBelow(day(d), lat, lng, 8.5)! - sunBelow(day(d), lat, lng, 0.833)!) / 60_000;
        expect(gap).toBeGreaterThan(30);
        expect(gap).toBeLessThan(56);
      }
    }
  });

  it('has no sunset in a polar summer', () => {
    expect(sunBelow(day('2026-06-21'), 78.2, 15.6, 0.833)).toBeNull();
    expect(
      restWindows(day('2026-06-15'), 78.2, 15.6, 'Arctic/Longyearbyen', {
        candles: 18,
        secondDay: false,
      }),
    ).toEqual([]);
  });
});

describe('days of rest (phase 74a)', () => {
  it('Shabbat is Saturday; holidays by the Hebrew calendar; the second day by choice', () => {
    expect(restDay(day('2026-11-07'), false)).toBe('shabbat');
    expect(restDay(day('2026-11-06'), false)).toBeNull();
    // Rosh Hashanah 5787: 12-13 September 2026 (two days everywhere).
    expect(restDay(day('2026-09-13'), false)).toBe('holiday');
    // Yom Kippur 21 September 2026; Pesach 22 April 2027, its second day only outside Israel.
    expect(restDay(day('2026-09-21'), false)).toBe('holiday');
    expect(restDay(day('2027-04-22'), false)).toBe('holiday');
    expect(restDay(day('2027-04-23'), false)).toBeNull();
    expect(restDay(day('2027-04-23'), true)).toBe('holiday');
    // Shavuot 11 June 2027 (Friday): Shabbat follows.
    expect(restDay(day('2027-06-11'), false)).toBe('holiday');
  });

  it('a rest runs from candle lighting to nightfall, and adjacent days merge', () => {
    const [rest] = restWindows(day('2026-11-02'), ...JERUSALEM, 'Asia/Jerusalem', {
      candles: 40,
      secondDay: false,
    });
    expect(rest!.kind).toBe('shabbat');
    const sunsetFriday = sunBelow(day('2026-11-06'), ...JERUSALEM, 0.833)!;
    expect(rest!.start).toBe(sunsetFriday - 40 * 60_000);
    expect(rest!.end).toBe(sunBelow(day('2026-11-07'), ...JERUSALEM, 8.5));
    // Rosh Hashanah on Saturday and Sunday: one rest from Friday to Sunday night.
    const rh = restWindows(day('2026-09-09'), ...JERUSALEM, 'Asia/Jerusalem', {
      candles: 18,
      secondDay: false,
    })[0]!;
    expect(rh.kind).toBe('holiday');
    expect(localDay(rh.start, 'Asia/Jerusalem')).toBe('2026-09-11');
    expect(localDay(rh.end, 'Asia/Jerusalem')).toBe('2026-09-13');
    // Shavuot 5787 on Friday; its second day (outside Israel) is Shabbat: Thursday evening to
    // Saturday night.
    const sh = restWindows(day('2027-06-08'), ...NEW_YORK, 'America/New_York', {
      candles: 18,
      secondDay: true,
    })[0]!;
    expect(localDay(sh.start, 'America/New_York')).toBe('2027-06-10');
    expect(localDay(sh.end, 'America/New_York')).toBe('2027-06-12');
  });

  it('knows whether it is a rest now', () => {
    const options = { candles: 18, secondDay: false };
    expect(
      currentRest(at('2026-11-07T12:00:00+02:00'), ...JERUSALEM, 'Asia/Jerusalem', options)?.kind,
    ).toBe('shabbat');
    expect(
      currentRest(at('2026-11-06T12:00:00+02:00'), ...JERUSALEM, 'Asia/Jerusalem', options),
    ).toBeNull();
    expect(
      currentRest(at('2026-11-07T23:00:00+02:00'), ...JERUSALEM, 'Asia/Jerusalem', options),
    ).toBeNull();
  });
});
