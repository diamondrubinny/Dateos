// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { federatedCardSchema } from '../src/federation.js';
import { allowedIdentity, defaultIdentitySettings, identityInputSchema } from '../src/identity.js';

describe('gender identity and pronouns (phase 62a)', () => {
  it("own words: letters of any script, spaces, - ' and /; 2 to 30 characters", () => {
    const own = (genderCustom: string) =>
      identityInputSchema.safeParse({ genderIdentity: null, genderCustom, pronouns: null }).success;
    for (const ok of [
      'Queer',
      'קווירית / Queer',
      'Two-spirit',
      'Небинарн',
      'لا ثنائي',
      "Femme d'abord",
    ])
      expect(own(ok), ok).toBe(true);
    for (const bad of ['x', 'x'.repeat(31), '<b>', '1234', 'a@b', 'http://x', ' -lead', 'a\nb'])
      expect(own(bad), bad).toBe(false);
  });

  it('a list key or own words, not both; visible to matches only by default', () => {
    expect(
      identityInputSchema.safeParse({
        genderIdentity: 'nonbinary',
        genderCustom: 'Queer',
        pronouns: null,
      }).success,
    ).toBe(false);
    const parsed = identityInputSchema.parse({
      genderIdentity: 'nonbinary',
      genderCustom: null,
      pronouns: 'neutral',
    });
    expect(parsed.visibility).toBe('matches');
    expect(
      identityInputSchema.safeParse({
        genderIdentity: 'unicorn',
        genderCustom: null,
        pronouns: null,
      }).success,
    ).toBe(false);
  });

  it('shows only what the community offers right now', () => {
    const stored = {
      genderIdentity: 'trans_man' as const,
      genderCustom: null,
      pronouns: 'masculine' as const,
    };
    expect(allowedIdentity(stored, defaultIdentitySettings)).toEqual(stored);
    expect(allowedIdentity(stored, { ...defaultIdentitySettings, vocabulary: 'basic' })).toEqual({
      genderIdentity: null,
      genderCustom: null,
      pronouns: 'masculine',
    });
    expect(
      allowedIdentity(stored, { vocabulary: 'basic', customGender: true, pronouns: false }),
    ).toBeNull();
    const own = { genderIdentity: null, genderCustom: 'Queer', pronouns: null };
    expect(allowedIdentity(own, defaultIdentitySettings)).toBeNull(); // own words off by default
    expect(allowedIdentity(own, { ...defaultIdentitySettings, customGender: true })).toEqual(own);
  });

  it('a card for a partner community never carries it', () => {
    const card = federatedCardSchema.parse({
      alias: 'a'.repeat(22),
      displayName: 'Noa',
      age: 30,
      gender: 'nonbinary',
      intention: 'long_term',
      bio: null,
      languages: ['he'],
      prompts: [],
      photos: [{ id: '00000000-0000-4000-8000-000000000000', width: 10, height: 10 }],
      verified: false,
      identity: { genderIdentity: 'nonbinary', genderCustom: null, pronouns: 'neutral' },
    });
    expect(card).not.toHaveProperty('identity');
  });
});
