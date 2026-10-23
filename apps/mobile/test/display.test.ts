// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ AccessibilityInfo: {} }));
vi.mock('../src/lib/storage', () => ({ prefs: {} }));

const { defaultDisplay, parseDisplay, TEXT_SCALE } = await import('../src/lib/display');

describe('display settings (phase 25)', () => {
  it('reads what was stored', () => {
    expect(
      parseDisplay(
        JSON.stringify({ textSize: 'larger', easy: true, contrast: true, reduceMotion: false }),
      ),
    ).toEqual({ textSize: 'larger', easy: true, contrast: true, reduceMotion: false });
  });

  it('falls back to the defaults on anything unexpected', () => {
    expect(parseDisplay(null)).toEqual(defaultDisplay);
    expect(parseDisplay('not json')).toEqual(defaultDisplay);
    expect(parseDisplay('[]')).toEqual(defaultDisplay);
    expect(parseDisplay(JSON.stringify({ textSize: 'huge', easy: 'yes', contrast: 1 }))).toEqual(
      defaultDisplay,
    );
  });

  it('keeps text growth bounded', () => {
    expect(Math.max(...Object.values(TEXT_SCALE))).toBeLessThanOrEqual(1.5);
  });
});
