// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Contrast-checked tokens (tested in test/contrast.test.ts):
 * - text, muted, primary, danger and success on every background meet WCAG AA for text (≥ 4.5:1);
 * - `control` (the edge of text fields and choice chips) and `focus` meet 3:1 against the page and
 *   surfaces (WCAG 1.4.11 non-text contrast). `border` is decorative only (separators, cards).
 */
export const light = {
  background: '#FFFFFF',
  surface: '#F6F3FF',
  border: '#D9D2EE',
  control: '#7E7698',
  text: '#1B1530',
  muted: '#5B5470',
  primary: '#6D28D9',
  onPrimary: '#FFFFFF',
  primarySoft: '#EDE5FF',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  success: '#067647',
  successSoft: '#E7F6EC',
  focus: '#B45309',
};

export const dark: typeof light = {
  background: '#120F1C',
  surface: '#1E1930',
  border: '#3A3352',
  control: '#837AA0',
  text: '#F4F1FA',
  muted: '#B9B2CC',
  primary: '#A78BFA',
  onPrimary: '#120F1C',
  primarySoft: '#2E2550',
  danger: '#F97066',
  dangerSoft: '#3D1A17',
  success: '#47CD89',
  successSoft: '#123222',
  focus: '#FBBF24',
};

export type Colors = typeof light;

/**
 * The keyboard focus ring: 3 px, 2 px away from the control, so it contrasts with the page around
 * it rather than with the control's own fill (WCAG 2.4.7 and 1.4.11).
 */
export const focusRing = (colors: Pick<Colors, 'focus'>) => ({
  outlineColor: colors.focus,
  outlineWidth: 3,
  outlineOffset: 2,
  outlineStyle: 'solid' as const,
});
