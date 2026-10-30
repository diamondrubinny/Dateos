// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { signupModes } from './trust.js';
import { identityVocabularies } from './identity.js';
import { genders, genderSchema, intentions, intentionSchema, MAX_AGE, MIN_AGE } from './profile.js';
import { MAX_CALL_MAX_MINUTES, MIN_CALL_MAX_MINUTES } from './calls.js';
import { localeSchema } from './common.js';

/** WCAG 2.x relative luminance of a #RRGGBB color. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear mix: weight 0 → a, 1 → b. */
export function mix(a: string, b: string, weight: number): string {
  const out = [1, 3, 5].map((i) => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * weight)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${out.join('')}`.toUpperCase();
}

/** Shipped default; the app shows the tagline only when an operator replaced it. */
export const DEFAULT_TAGLINE = 'Free, open-source dating. Built for real connections.';

export const LIGHT_BACKGROUND = '#FFFFFF';
export const DARK_BACKGROUND = '#120F1C';
export const MIN_CONTRAST = 4.5;
/**
 * Every background the apps put brand-coloured text on: page, surface (cards), and the soft red and
 * green panels. Kept in sync with the app's theme tokens (apps/mobile/test/contrast.test.ts).
 */
export const LIGHT_BACKGROUNDS = ['#FFFFFF', '#F6F3FF', '#FDECEA', '#E7F6EC'] as const;
export const DARK_BACKGROUNDS = ['#120F1C', '#1E1930', '#3D1A17', '#123222'] as const;

/** The brand color must carry white text (buttons) and work as text on white (links): AA. */
export function isAccessiblePrimary(hex: string): boolean {
  return contrastRatio(hex, LIGHT_BACKGROUND) >= MIN_CONTRAST;
}

export interface BrandPalette {
  primary: string;
  primarySoft: string;
}

/**
 * Light and dark variants of the brand color, with AA contrast (4.5:1) for brand-coloured text on
 * every background the apps use, including the soft brand colour itself (secondary buttons).
 * Light mode darkens the colour and dark mode lightens it, each in small steps and only as far as
 * needed; both end at black or white, which always pass, so the loops always finish.
 */
export function deriveBrand(primary: string): { light: BrandPalette; dark: BrandPalette } {
  const base = primary.toUpperCase();
  const lightSoft = mix(base, '#FFFFFF', 0.88);
  const darkSoft = mix(base, DARK_BACKGROUND, 0.7);
  const readsOn = (color: string, backgrounds: readonly string[]) =>
    backgrounds.every((bg) => contrastRatio(color, bg) >= MIN_CONTRAST);
  const adjust = (towards: string, backgrounds: readonly string[]) => {
    for (let w = 0; w < 1; w += 0.02) {
      const color = w === 0 ? base : mix(base, towards, w);
      if (readsOn(color, backgrounds)) return color;
    }
    return towards;
  };
  return {
    light: {
      primary: adjust('#000000', [...LIGHT_BACKGROUNDS, lightSoft]),
      primarySoft: lightSoft,
    },
    dark: { primary: adjust('#FFFFFF', [...DARK_BACKGROUNDS, darkSoft]), primarySoft: darkSoft },
  };
}

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB color');

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // Branding is shown as plain text everywhere; control characters are never valid.
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .refine((v) => !/[\u0000-\u001F\u007F<>]/.test(v), 'Plain text only');

/** Phase 62c: the longest community declaration. */
export const MAX_JOIN_DECLARATION = 300;

export const instanceSettingsInputSchema = z
  .object({
    name: plainText(40),
    tagline: plainText(120),
    primaryColor: hexColorSchema.refine(
      isAccessiblePrimary,
      'Too light: white text on this color would be hard to read (needs 4.5:1 contrast).',
    ),
    defaultLocale: localeSchema,
    operatorName: plainText(100).nullable(),
    contactEmail: z.email().max(254).nullable(),
    sponsorUrl: z
      .url({ protocol: /^https$/ })
      .max(300)
      .nullable(),
    callsEnabled: z.boolean(),
    callMaxMinutes: z.number().int().min(MIN_CALL_MAX_MINUTES).max(MAX_CALL_MAX_MINUTES),
    signupMode: z.enum(signupModes),
    memberInvites: z.boolean(),
    /** Phase 62a: gender identity and pronouns the community offers. */
    identityVocabulary: z.enum(identityVocabularies),
    identityCustom: z.boolean(),
    identityPronouns: z.boolean(),
    /** Phase 62b: intentions offered (at least one) and the faith module. */
    intentionsOffered: z
      .array(intentionSchema)
      .min(1)
      .max(intentions.length)
      .refine((l) => new Set(l).size === l.length),
    faithModule: z.boolean(),
    /** Phase 66a: everyone's photos are blurred until two people match. */
    photosAfterMatch: z.boolean(),
    /**
     * Phase 62c, who may join: ages (never below 18), genders (empty: everyone) and a declaration
     * every new member confirms. ⚖️ Restricting membership may not be lawful everywhere.
     */
    joinMinAge: z.number().int().min(MIN_AGE).max(99),
    joinMaxAge: z.number().int().min(MIN_AGE).max(MAX_AGE).nullable(),
    joinGenders: z
      .array(genderSchema)
      .max(genders.length)
      .refine((l) => new Set(l).size === l.length),
    joinDeclaration: plainText(MAX_JOIN_DECLARATION).nullable(),
    /** Phase 63: require an age check (only where a provider is configured on the server). */
    ageCheckRequired: z.boolean(),
  })
  .partial();
export type InstanceSettingsInput = z.infer<typeof instanceSettingsInputSchema>;

export const setupClaimSchema = z.object({ token: z.string().min(16).max(200) });
