// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { ageOn, preferencesSchema, profileInputSchema, promptsInputSchema } from '../src/index.js';

describe('ageOn', () => {
  it('counts whole years and flips exactly on the birthday', () => {
    expect(ageOn('2008-10-20', '2026-10-19')).toBe(17);
    expect(ageOn('2008-10-20', '2026-10-20')).toBe(18);
    expect(ageOn('2008-10-20', '2026-12-31')).toBe(18);
  });

  it('handles leap-day birthdays (birthday counted from March 1st in common years)', () => {
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
  });
});

describe('profileInputSchema', () => {
  const valid = {
    displayName: '  Noa  ',
    birthDate: '1995-04-12',
    gender: 'woman',
    interestedIn: ['man'],
    intention: 'long_term',
  };

  it('trims names and defaults languages', () => {
    const parsed = profileInputSchema.parse(valid);
    expect(parsed.displayName).toBe('Noa');
    expect(parsed.languages).toEqual([]);
  });

  it('rejects invalid dates, empty names and empty interests', () => {
    expect(() => profileInputSchema.parse({ ...valid, birthDate: '1995-02-30' })).toThrow();
    expect(() => profileInputSchema.parse({ ...valid, displayName: '   ' })).toThrow();
    expect(() => profileInputSchema.parse({ ...valid, interestedIn: [] })).toThrow();
  });
});

describe('preferencesSchema', () => {
  it('requires ageMin <= ageMax and adults only', () => {
    const base = { maxDistanceKm: 20, intentions: [] };
    expect(preferencesSchema.safeParse({ ...base, ageMin: 25, ageMax: 30 }).success).toBe(true);
    expect(preferencesSchema.safeParse({ ...base, ageMin: 31, ageMax: 30 }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...base, ageMin: 17, ageMax: 30 }).success).toBe(false);
  });
});

describe('promptsInputSchema', () => {
  it('allows at most three distinct prompts', () => {
    const p = (promptKey: string) => ({ promptKey, answer: 'x' });
    expect(promptsInputSchema.safeParse([p('green_flag'), p('green_flag')]).success).toBe(false);
    expect(
      promptsInputSchema.safeParse([
        p('green_flag'),
        p('looking_for'),
        p('perfect_sunday'),
        p('geek_out_about'),
      ]).success,
    ).toBe(false);
  });
});
