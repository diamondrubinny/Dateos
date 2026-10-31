// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Who sees me, and when (phase 18). "Take a break" hides a member from new people for a while;
 * existing matches and chats carry on, so a break never ghosts anyone.
 */
export const pauseDurations = ['24h', '3d', '7d', 'indefinite'] as const;
export type PauseDuration = (typeof pauseDurations)[number];

const PAUSE_HOURS: Record<Exclude<PauseDuration, 'indefinite'>, number> = {
  '24h': 24,
  '3d': 72,
  '7d': 168,
};

export const pauseInputSchema = z.object({ duration: z.enum(pauseDurations) });
export type PauseInput = z.infer<typeof pauseInputSchema>;

/** When a break chosen now ends by itself, or null for "until I turn it back on". */
export function pauseEndsAt(duration: PauseDuration, now: Date): Date | null {
  return duration === 'indefinite'
    ? null
    : new Date(now.getTime() + PAUSE_HOURS[duration] * 3_600_000);
}

/** null: not on a break. `until` null: until the member turns it back on. */
export const pauseStateSchema = z
  .object({ since: z.string(), until: z.string().nullable() })
  .nullable();
export type PauseState = z.infer<typeof pauseStateSchema>;

/** The worker checks for ended breaks this often (the API already treats them as over). */
export const PAUSE_SWEEP_SECONDS = 300;

/** Incognito (phase 18b): only people I liked can see me. Nobody is ever told who is incognito. */
export const incognitoInputSchema = z.object({ on: z.boolean() });
export type IncognitoInput = z.infer<typeof incognitoInputSchema>;

/**
 * Travel mode (phase 18c): Discover and distances work from a city's centre for up to two weeks,
 * and the profile honestly says "Visiting {city}". Cities come from a bundled GeoNames list
 * (CC BY 4.0), searched on our own server: what people type never reaches a geocoding service.
 */
export const TRAVEL_MAX_DAYS = 14;
export const travelDayOptions = [3, 7, 14] as const;
/** Ended trips are kept this long (for "Download my data"), then deleted. */
export const TRAVEL_RETENTION_DAYS = 30;

export const cityNamesSchema = z.object({
  en: z.string(),
  he: z.string().nullable(),
  ar: z.string().nullable(),
  ru: z.string().nullable(),
});
export type CityNames = z.infer<typeof cityNamesSchema>;

/** The city's name in the member's language, or its English name. */
export function cityName(names: CityNames, locale: string): string {
  const lang = locale.split('-')[0] as keyof CityNames;
  return (lang in names ? names[lang] : null) ?? names.en;
}

export const placeSchema = z.object({
  id: z.number().int(),
  names: cityNamesSchema,
  /** ISO 3166-1 alpha-2 country code. */
  country: z.string(),
});
export type Place = z.infer<typeof placeSchema>;

export const placesQuerySchema = z.object({ q: z.string().trim().min(2).max(60) });

export const travelInputSchema = z.object({
  cityId: z.number().int().positive(),
  days: z.number().int().min(1).max(TRAVEL_MAX_DAYS),
  /**
   * Phase 67b: in a country the community considers at risk, hide me from new people for the trip
   * (the default there); ignored elsewhere.
   */
  hideWhileThere: z.boolean().optional(),
});
export type TravelInput = z.infer<typeof travelInputSchema>;

/** null: at home. */
export const travelStateSchema = placeSchema
  .extend({
    until: z.string(),
    /** Phase 67b: a country the community considers at risk, and whether I'm hidden there. */
    atRisk: z.boolean(),
    hidden: z.boolean(),
  })
  .nullable();
export type TravelState = z.infer<typeof travelStateSchema>;

// ---------------------------------------------------------------------------
// Phase 70: "My visibility", the opposite of a shadow ban
// ---------------------------------------------------------------------------

/** With this many matches waiting 3+ days for my reply, new people see me a bit less. */
export const UNANSWERED_LIMIT = 5;

/** Everything that keeps new people from finding me, fully or partly. */
export const visibilityCodes = [
  'on_break',
  'incognito',
  'no_photo',
  'no_location',
  'pending_review',
  'like_limit',
  'verified_only',
  'unanswered',
] as const;
export type VisibilityCode = (typeof visibilityCodes)[number];

export const visibilityItemSchema = z.object({
  code: z.enum(visibilityCodes),
  /** Hidden from new people (true) or only seen less / by fewer (false). */
  hides: z.boolean(),
  /** on_break: when the break ends (null: until I end it). */
  until: z.string().nullable().optional(),
  /** unanswered: people waiting; like_limit: the limit. */
  count: z.number().int().optional(),
});
export type VisibilityItem = z.infer<typeof visibilityItemSchema>;

export const myVisibilitySchema = z.object({
  /** Nothing limits it: new people can find me as usual. */
  visible: z.boolean(),
  items: z.array(visibilityItemSchema),
});
export type MyVisibility = z.infer<typeof myVisibilitySchema>;
