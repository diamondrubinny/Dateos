// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { contrastRatio, DARK_BACKGROUNDS, LIGHT_BACKGROUNDS } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import { dark, light, type Colors } from '../src/lib/tokens';

/** The app's text colours on the app's backgrounds (phase 47): WCAG AA in both modes. */
const themes = { light, dark } as const;
const texts = ['text', 'muted', 'primary', 'danger', 'success'] as const;
const backgrounds = ['background', 'surface', 'primarySoft', 'dangerSoft', 'successSoft'] as const;
/** High contrast (phase 25): muted text as strong as body text. */
const highContrast = (c: Colors): Colors => ({ ...c, muted: c.text, border: c.muted });

describe.each(Object.entries(themes))('%s theme', (name, colors) => {
  it.each([colors, highContrast(colors)].map((c, i) => [i ? 'high contrast' : 'default', c]))(
    'every text colour on every background is at least 4.5:1 (%s)',
    (_, c) => {
      for (const fg of texts) {
        for (const bg of backgrounds) {
          expect(contrastRatio(c[fg], c[bg]), `${name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
    },
  );

  it('button text on filled buttons is at least 4.5:1', () => {
    expect(contrastRatio(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.onPrimary, colors.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it('field edges and the focus ring are at least 3:1 against the page (WCAG 1.4.11)', () => {
    for (const bg of ['background', 'surface'] as const) {
      expect(contrastRatio(colors.control, colors[bg]), `control on ${bg}`).toBeGreaterThanOrEqual(
        3,
      );
      expect(contrastRatio(colors.focus, colors[bg]), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the brand palette is checked against these same backgrounds', () => {
    const list = name === 'light' ? LIGHT_BACKGROUNDS : DARK_BACKGROUNDS;
    expect([...list]).toEqual([
      colors.background,
      colors.surface,
      colors.dangerSoft,
      colors.successSoft,
    ]);
  });
});
