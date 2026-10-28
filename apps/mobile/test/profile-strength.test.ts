// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { MeResponse } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import { strengthItems } from '../src/lib/profile-strength';

const photo = (status: 'clean' | 'rejected' | 'processing') => ({ status }) as never;
const base = {
  photos: [photo('clean')],
  profile: { bio: null },
  prompts: [],
  about: { interests: [] },
  verified: false,
  voicePrompt: null,
} as unknown as MeResponse;
const done = (me: MeResponse) => Object.fromEntries(strengthItems(me).map((i) => [i.key, i.done]));

describe('strengthItems', () => {
  it('lists what a new profile is missing', () => {
    expect(done(base)).toEqual({
      photos: false,
      bio: false,
      prompts: false,
      interests: false,
      verified: false,
      voice: false,
    });
  });

  it('counts only clean photos and ignores a blank bio', () => {
    const me = {
      ...base,
      photos: [photo('clean'), photo('clean'), photo('rejected'), photo('processing')],
      profile: { bio: '   ' },
    } as unknown as MeResponse;
    expect(done(me).photos).toBe(false);
    expect(done(me).bio).toBe(false);
  });

  it('marks a complete profile done everywhere', () => {
    const me = {
      ...base,
      photos: [photo('clean'), photo('clean'), photo('clean')],
      profile: { bio: 'Hiking and coffee' },
      prompts: [{}, {}],
      about: { interests: ['hiking'] },
      verified: true,
      voicePrompt: {},
    } as unknown as MeResponse;
    expect(Object.values(done(me)).every(Boolean)).toBe(true);
  });
});
