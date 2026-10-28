// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { MeResponse } from '@nexaheart/shared';
import type { Href } from 'expo-router';

/** Photos and prompt answers that make a profile feel complete (phase 35). */
export const STRONG_PHOTOS = 3;
export const STRONG_PROMPTS = 2;

type Item = { key: string; done: boolean; href: Href };

/** What a strong profile has, computed from /v1/me on the device; nothing is sent anywhere. */
export function strengthItems(me: MeResponse): Item[] {
  return [
    {
      key: 'photos',
      done: me.photos.filter((p) => p.status === 'clean').length >= STRONG_PHOTOS,
      href: '/onboarding/photos?edit=1',
    },
    { key: 'bio', done: Boolean(me.profile?.bio?.trim()), href: '/edit-bio' },
    {
      key: 'prompts',
      done: me.prompts.length >= STRONG_PROMPTS,
      href: '/onboarding/prompts?edit=1',
    },
    { key: 'interests', done: me.about.interests.length > 0, href: '/edit-about' },
    { key: 'verified', done: me.verified, href: '/verify' },
    { key: 'voice', done: me.voicePrompt !== null, href: '/edit-about' },
  ];
}
