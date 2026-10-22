// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  DARK_BACKGROUND,
  deriveBrand,
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
