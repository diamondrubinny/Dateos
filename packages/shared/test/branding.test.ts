// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  DARK_BACKGROUND,
  DARK_BACKGROUNDS,
  deriveBrand,
  LIGHT_BACKGROUNDS,
  instanceSettingsInputSchema,
  isAccessiblePrimary,
  mix,
} from '../src/branding.js';

describe('branding colors', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#6D28D9', '#FFFFFF')).toBeGreaterThan(4.5);
  });

  it('accepts readable brand colors and rejects light ones', () => {
    expect(isAccessiblePrimary('#6D28D9')).toBe(true);
    expect(isAccessiblePrimary('#0F766E')).toBe(true);
    expect(isAccessiblePrimary('#FACC15')).toBe(false); // yellow
    expect(isAccessiblePrimary('#A78BFA')).toBe(false);
  });

  it('derives a dark-mode color with AA contrast for any accepted color', () => {
    for (const c of ['#6D28D9', '#0F766E', '#B91C1C', '#1D4ED8', '#000000', '#7C2D12']) {
      const { dark, light } = deriveBrand(c);
      expect(contrastRatio(dark.primary, DARK_BACKGROUND), c).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light.primary, '#FFFFFF'), c).toBeGreaterThanOrEqual(4.5);
      expect(light.primarySoft).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('every accepted brand color reads at AA on every background, in both modes (phase 47)', () => {
    // A grid over the colour space: everything the server would accept as a brand colour.
    const steps = ['00', '33', '66', '76', '99', 'CC', 'FF'];
    const accepted = steps
      .flatMap((r) => steps.flatMap((g) => steps.map((b) => `#${r}${g}${b}`)))
      .filter(isAccessiblePrimary);
    expect(accepted.length).toBeGreaterThan(50);
    for (const c of accepted) {
      const { light, dark } = deriveBrand(c);
      // Text in the brand colour, and secondary buttons (brand text on the soft brand colour).
      for (const bg of [...LIGHT_BACKGROUNDS, light.primarySoft]) {
        expect(contrastRatio(light.primary, bg), `${c} light on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of [...DARK_BACKGROUNDS, dark.primarySoft]) {
        expect(contrastRatio(dark.primary, bg), `${c} dark on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      // Primary buttons: white text in light mode, the dark background colour in dark mode.
      expect(contrastRatio(light.primary, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark.primary, DARK_BACKGROUND)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('changes a colour that already works as little as possible', () => {
    // The default colour in light mode is used as is.
    expect(deriveBrand('#6D28D9').light.primary).toBe('#6D28D9');
  });

  it('mixes colors', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('instance settings input', () => {
  it('validates branding fields', () => {
    expect(instanceSettingsInputSchema.safeParse({ name: 'Ahava TLV' }).success).toBe(true);
    expect(instanceSettingsInputSchema.safeParse({ name: '<script>' }).success).toBe(false);
    expect(instanceSettingsInputSchema.safeParse({ primaryColor: '#FFFF00' }).success).toBe(false);
    expect(instanceSettingsInputSchema.safeParse({ sponsorUrl: 'http://x.example' }).success).toBe(
      false,
    );
    expect(
      instanceSettingsInputSchema.safeParse({ sponsorUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      instanceSettingsInputSchema.safeParse({ sponsorUrl: 'https://opencollective.com/x' }).success,
    ).toBe(true);
    expect(instanceSettingsInputSchema.safeParse({ contactEmail: null }).success).toBe(true);
  });
});
