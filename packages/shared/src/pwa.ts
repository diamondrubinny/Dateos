// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { isRtl, localeSchema } from './common.js';
import type { InstanceInfo } from './profile.js';

/**
 * Phase 57: the web app's icons, as the build writes them (apps/mobile/scripts/web-pwa.mjs). Paths
 * on the app's own origin.
 */
export const PWA_ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] as const;

/** Home-screen labels are short: longer names are cut (whole characters, not halves of emoji). */
export const PWA_SHORT_NAME_MAX = 12;

export interface WebManifest {
  name: string;
  short_name: string;
  description: string;
  id: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  orientation: 'portrait';
  lang: string;
  dir: 'ltr' | 'rtl';
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

/**
 * Phase 57: the web app manifest from the community's own branding, so "Install app" / "Add to Home
 * screen" shows the community's name and colour, in its language's direction. Only public branding
 * (the same as `/v1/instance`). Paths are relative to the app's origin, where Caddy serves it.
 */
export function webManifest(
  info: Pick<InstanceInfo, 'name' | 'tagline' | 'defaultLocale' | 'brand'>,
): WebManifest {
  const name = info.name.replace(/\s+/g, ' ').trim() || 'NexaHeart';
  const chars = Array.from(name);
  const shortName =
    chars.length <= PWA_SHORT_NAME_MAX ? name : chars.slice(0, PWA_SHORT_NAME_MAX).join('').trim();
  const locale = localeSchema.safeParse(info.defaultLocale);
  const lang = locale.success ? locale.data : 'en';
  return {
    name,
    short_name: shortName,
    description: info.tagline.replace(/\s+/g, ' ').trim(),
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang,
    dir: locale.success && isRtl(locale.data) ? 'rtl' : 'ltr',
    theme_color: info.brand.light.primary,
    background_color: '#FFFFFF',
    icons: PWA_ICONS.map((icon) => ({ ...icon })),
  };
}
