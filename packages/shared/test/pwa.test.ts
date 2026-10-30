// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { deriveBrand } from '../src/branding.js';
import { PWA_SHORT_NAME_MAX, webManifest } from '../src/pwa.js';

const info = (name: string, defaultLocale = 'en') => ({
  name,
  tagline: 'Dating that respects you',
  defaultLocale,
  brand: deriveBrand('#7C3AED'),
});

describe('the web app manifest (phase 57)', () => {
  it('carries the community’s name, colour and an installable shape', () => {
    const m = webManifest(info('Ahava'));
    expect(m).toMatchObject({
      name: 'Ahava',
      short_name: 'Ahava',
      description: 'Dating that respects you',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      lang: 'en',
      dir: 'ltr',
      theme_color: deriveBrand('#7C3AED').light.primary,
    });
    // Chrome needs a 192 and a 512 icon; a maskable one keeps Android from boxing it.
    expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
  });

  it('follows the community’s language direction', () => {
    expect(webManifest(info('אהבה', 'he'))).toMatchObject({ lang: 'he', dir: 'rtl' });
    expect(webManifest(info('حب', 'ar'))).toMatchObject({ lang: 'ar', dir: 'rtl' });
    expect(webManifest(info('Любовь', 'ru'))).toMatchObject({ lang: 'ru', dir: 'ltr' });
    expect(webManifest(info('X', 'xx'))).toMatchObject({ lang: 'en', dir: 'ltr' });
  });

  it('shortens a long name for the home screen, by whole characters', () => {
    const long = webManifest(info('The Tel Aviv Singles Community'));
    expect(long.name).toBe('The Tel Aviv Singles Community');
    expect(Array.from(long.short_name).length).toBeLessThanOrEqual(PWA_SHORT_NAME_MAX);
    expect(long.short_name).toBe('The Tel Aviv');
    const emoji = webManifest(info('💜💜💜💜💜💜💜💜💜💜💜💜💜💜'));
    expect(Array.from(emoji.short_name)).toHaveLength(PWA_SHORT_NAME_MAX);
    expect(webManifest(info('  \n ')).name).toBe('NexaHeart');
  });
});
