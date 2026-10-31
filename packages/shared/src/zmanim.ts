// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Phase 74a: Shabbat and holiday times, written here (no dependency). Sunset and nightfall use the
 * NOAA/"sunrise equation" approximation (about a minute off at mid latitudes); the holidays come
 * from ICU's Hebrew calendar (`Intl`). 📘 Customs differ: the minutes before sunset and a second
 * day of holidays are settings. Checked against published tables in the tests.
 */

/** Minutes before sunset for candle lighting, as communities light (40: Jerusalem). */
export const candleMinutes = [18, 20, 22, 30, 40] as const;
export type CandleMinutes = (typeof candleMinutes)[number];
export const DEFAULT_CANDLE_MINUTES: CandleMinutes = 18;
/** Nightfall: the sun 8.5° below the horizon (a common custom for the end of Shabbat). 📘 */
export const NIGHTFALL_DEPRESSION = 8.5;
/** Sunset: the top of the sun at the horizon, with refraction. */
const SUNSET_DEPRESSION = 0.833;

/** Version of the in-app text for the `shabbat` consent; bump it when the wording changes. */
export const SHABBAT_CONSENT_VERSION = '1';

const DAY = 86_400_000;
const rad = Math.PI / 180;

/**
 * When the sun goes `depression` degrees below the horizon in the evening of the civil date
 * (UTC midnight of that date in `date`), at a place; null where it doesn't (polar days and nights).
 */
export function sunBelow(dateUtcMidnight: number, lat: number, lng: number, depression: number) {
  // The mean solar noon of that day at that longitude, in days since 2000-01-01 12:00 TT.
  const julian = dateUtcMidnight / DAY + 2440587.5 + 0.5;
  const n = Math.round(julian - 2451545.0 - 0.0008);
  const meanNoon = n - lng / 360;
  const M = (357.5291 + 0.98560028 * meanNoon) % 360;
  const C =
    1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit =
    2451545.0 + meanNoon + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDecl = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosDecl = Math.cos(Math.asin(sinDecl));
  const cosHour =
    (Math.sin(-depression * rad) - Math.sin(lat * rad) * sinDecl) / (Math.cos(lat * rad) * cosDecl);
  if (cosHour < -1 || cosHour > 1) return null;
  const set = transit + Math.acos(cosHour) / rad / 360;
  return Math.round((set - 2440587.5) * DAY);
}

export interface RestOptions {
  candles: number;
  /** A second day of holidays (outside Israel). */
  secondDay: boolean;
}

/** Hebrew month (as ICU names it in English) and day of each holiday that is a day of rest. */
const HOLIDAYS: { month: string; day: number; second?: true }[] = [
  { month: 'Tishri', day: 1 },
  { month: 'Tishri', day: 2 }, // Rosh Hashanah is two days everywhere.
  { month: 'Tishri', day: 10 },
  { month: 'Tishri', day: 15 },
  { month: 'Tishri', day: 16, second: true },
  { month: 'Tishri', day: 22 },
  { month: 'Tishri', day: 23, second: true },
  { month: 'Nisan', day: 15 },
  { month: 'Nisan', day: 16, second: true },
  { month: 'Nisan', day: 21 },
  { month: 'Nisan', day: 22, second: true },
  { month: 'Sivan', day: 6 },
  { month: 'Sivan', day: 7, second: true },
];

let hebrewFormat: Intl.DateTimeFormat | null | undefined;
/** The Hebrew month and day of a civil date (taken at UTC noon), or null without ICU's calendar. */
function hebrewDay(dateUtcMidnight: number): { month: string; day: number } | null {
  if (hebrewFormat === undefined) {
    try {
      const f = new Intl.DateTimeFormat('en-u-ca-hebrew', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
      hebrewFormat = f.resolvedOptions().calendar === 'hebrew' ? f : null;
    } catch {
      hebrewFormat = null;
    }
  }
  if (!hebrewFormat) return null;
  const parts = hebrewFormat.formatToParts(new Date(dateUtcMidnight + DAY / 2));
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return month && day ? { month, day } : null;
}

export type RestKind = 'shabbat' | 'holiday';

/** Whether a civil date is a day of rest, and which kind (a holiday wins over Shabbat). */
export function restDay(dateUtcMidnight: number, secondDay: boolean): RestKind | null {
  const h = hebrewDay(dateUtcMidnight);
  if (h && HOLIDAYS.some((x) => x.month === h.month && x.day === h.day && (!x.second || secondDay)))
    return 'holiday';
  return new Date(dateUtcMidnight).getUTCDay() === 6 ? 'shabbat' : null;
}

export interface RestWindow {
  start: number;
  end: number;
  /** `holiday` if any day in it is a holiday. */
  kind: RestKind;
}

/** The civil date at a place: by its time zone when known, else by its longitude. */
function localDate(at: number, lng: number, timeZone: string | null): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(at));
      const ms = Date.parse(`${parts}T00:00:00Z`);
      if (!Number.isNaN(ms)) return ms;
    } catch {
      // Unknown zone: fall through to the longitude.
    }
  }
  const shifted = at + (lng / 15) * 3_600_000;
  return shifted - (((shifted % DAY) + DAY) % DAY);
}

/**
 * The rests (Shabbat and holidays) that end after `from` and start within `days` of it, at a
 * place: from candle lighting the evening before the first day to nightfall of the last.
 * Consecutive days of rest are one rest. Empty where the sun doesn't set (polar regions).
 */
export function restWindows(
  from: number,
  lat: number,
  lng: number,
  timeZone: string | null,
  options: RestOptions,
  days = 14,
): RestWindow[] {
  const today = localDate(from, lng, timeZone);
  const windows: RestWindow[] = [];
  for (let d = today - DAY; d <= today + days * DAY; d += DAY) {
    const kind = restDay(d, options.secondDay);
    if (!kind) continue;
    const eve = sunBelow(d - DAY, lat, lng, SUNSET_DEPRESSION);
    const night = sunBelow(d, lat, lng, NIGHTFALL_DEPRESSION);
    if (eve === null || night === null) return [];
    const start = eve - options.candles * 60_000;
    const last = windows.at(-1);
    if (last && start <= last.end) {
      last.end = night;
      if (kind === 'holiday') last.kind = 'holiday';
    } else {
      windows.push({ start, end: night, kind });
    }
  }
  return windows.filter((w) => w.end > from);
}

/** The rest the place is in at `at`, if any. */
export function currentRest(
  at: number,
  lat: number,
  lng: number,
  timeZone: string | null,
  options: RestOptions,
): RestWindow | null {
  return restWindows(at, lat, lng, timeZone, options, 2).find((w) => w.start <= at) ?? null;
}

export const shabbatSettingsSchema = z.object({
  on: z.boolean(),
  /** Matches see "Keeping Shabbat" during the member's rest. */
  showMatches: z.boolean(),
  candles: z.number().int(),
  secondDay: z.boolean(),
  /** The approximate location is known, so times can be worked out. */
  located: z.boolean(),
  /** The next (or current) rest, when on and located. */
  next: z
    .object({ start: z.string(), end: z.string(), kind: z.enum(['shabbat', 'holiday']) })
    .nullable(),
});
export type ShabbatSettings = z.infer<typeof shabbatSettingsSchema>;

export const shabbatSettingsInputSchema = z
  .object({
    on: z.boolean(),
    showMatches: z.boolean(),
    candles: z
      .number()
      .int()
      .refine((n) => (candleMinutes as readonly number[]).includes(n)),
    secondDay: z.boolean(),
    timeZone: z.string().min(1).max(64),
  })
  .partial()
  .strict();
export type ShabbatSettingsInput = z.infer<typeof shabbatSettingsInputSchema>;
