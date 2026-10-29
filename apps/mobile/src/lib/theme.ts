// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useColorScheme } from 'react-native';
import { useDisplay } from './display';
import { useInstance } from './queries';

import { dark, light, type Colors } from './tokens';

export { focusRing, type Colors } from './tokens';

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
/** Minimum touch target (WCAG 2.5.5 / platform guidelines). */
export const MIN_TOUCH = 48;
/** Easy mode's larger touch target (phase 25). */
export const EASY_TOUCH = 56;

/**
 * Theme colors with the instance's brand color. The server only accepts brand colors with AA
 * contrast and derives a dark-mode variant, so text and buttons stay readable.
 */
export function useColors(): Colors {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const brand = useInstance().data?.brand[scheme];
  const { contrast } = useDisplay();
  const base = scheme === 'dark' ? dark : light;
  // Higher contrast (phase 25): muted text as strong as body text, borders clearly visible.
  const themed = contrast ? { ...base, muted: base.text, border: base.muted } : base;
  return brand ? { ...themed, primary: brand.primary, primarySoft: brand.primarySoft } : themed;
}
