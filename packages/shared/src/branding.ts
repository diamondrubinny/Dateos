// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
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

/** The brand color must carry white text (buttons) and work as text on white (links): AA. */
export function isAccessiblePrimary(hex: string): boolean {
  return contrastRatio(hex, LIGHT_BACKGROUND) >= MIN_CONTRAST;
}

export interface BrandPalette {
  primary: string;
  primarySoft: string;
}

/**
 * Light and dark variants of the brand color. In dark mode the color is lightened until it has
 * AA contrast against the dark background (and therefore with dark text on it).
 */
export function deriveBrand(primary: string): { light: BrandPalette; dark: BrandPalette } {
  const base = primary.toUpperCase();
  let dark = base;
  for (let w = 0; w <= 1 && contrastRatio(dark, DARK_BACKGROUND) < MIN_CONTRAST; w += 0.05) {
    dark = mix(base, '#FFFFFF', w);
  }
  return {
    light: { primary: base, primarySoft: mix(base, '#FFFFFF', 0.88) },
    dark: { primary: dark, primarySoft: mix(base, DARK_BACKGROUND, 0.7) },
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
  })
  .partial();
export type InstanceSettingsInput = z.infer<typeof instanceSettingsInputSchema>;

export const setupClaimSchema = z.object({ token: z.string().min(16).max(200) });
