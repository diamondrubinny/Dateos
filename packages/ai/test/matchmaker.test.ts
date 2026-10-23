// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import type { TextModel } from '../src/llm.js';
import {
  interpretText,
  type MatchmakerCurrent,
  mergeChoices,
  parseChoices,
  suggestChanges,
} from '../src/matchmaker.js';

const current: MatchmakerCurrent = {
  age: 30,
  intention: 'unsure',
  maxDistanceKm: 50,
  ageMin: 25,
  ageMax: 35,
  interests: ['hiking', 'coffee'],
  smokingOk: [],
  childrenOk: [],
};

const model = (reply: string, seen: { user?: string } = {}): TextModel => ({
  name: 'fake',
  external: false,
  async complete({ user }) {
    seen.user = user;
    return reply;
  },
});

describe('matchmaker rules', () => {
  it('turns answers into changes, with what they replace', () => {
    const out = suggestChanges(
      {
        looking: 'long_term',
        distance: 'city',
        ages: 'similar',
        enjoy: ['cooking', 'hiking'],
        smoking: 'no_smokers',
        children: 'want',
      },
      current,
    );
    expect(out).toEqual([
      { change: { field: 'intention', value: 'long_term' }, current: 'unsure' },
      { change: { field: 'maxDistanceKm', value: 15 }, current: 50 },
      // 25-35 is already "about the same age" for 30: no change.
      {
        change: { field: 'interests', value: ['hiking', 'coffee', 'cooking'] },
        current: ['hiking', 'coffee'],
      },
      { change: { field: 'smokingOk', value: ['no'] }, current: [] },
      { change: { field: 'childrenOk', value: ['want', 'have_want_more', 'open'] }, current: [] },
    ]);
  });

  it('suggests nothing when the answers match today, or were skipped', () => {
    expect(suggestChanges({}, current)).toEqual([]);
    expect(
      suggestChanges({ looking: 'unsure', distance: 'region', smoking: 'any' }, current),
    ).toEqual([]);
  });

  it('keeps ages inside 18 to 100, and interests within the limit', () => {
    const young = suggestChanges({ ages: 'younger' }, { ...current, age: 20 });
    expect(young[0]!.change).toEqual({ field: 'ages', value: { ageMin: 18, ageMax: 20 } });
    const many = suggestChanges(
      {
        enjoy: ['art', 'beach', 'cats', 'dogs', 'gym', 'yoga', 'wine', 'tech', 'travel', 'reading'],
      },
      current,
    );
    expect(many[0]!.change.value).toHaveLength(10);
    expect((many[0]!.change.value as string[]).slice(0, 2)).toEqual(['hiking', 'coffee']);
  });
});

describe('reading free text', () => {
  it('keeps only allowed values, field by field', () => {
    expect(
      parseChoices(
        'Sure! {"looking":"long_term","distance":"moon","enjoy":["cooking","cooking","skydiving"],"gender":"woman","ages":"older"}',
      ),
    ).toEqual({ looking: 'long_term', ages: 'older' });
    expect(parseChoices('{"enjoy":["cooking","reading"]}')).toEqual({
      enjoy: ['cooking', 'reading'],
    });
    expect(parseChoices('not json')).toEqual({});
    expect(parseChoices('[1,2]')).toEqual({});
  });

  it('asks the model only with the text, and never with contact details', async () => {
    const seen: { user?: string } = {};
    const read = await interpretText(
      model('{"looking":"long_term","enjoy":["cooking"]}', seen),
      'Someone kind who loves to cook, for something serious',
    );
    expect(read).toEqual({ looking: 'long_term', enjoy: ['cooking'] });
    expect(seen.user).toContain('loves to cook');

    const untouched: { user?: string } = {};
    expect(await interpretText(model('{}', untouched), 'Call me on 054-1234567')).toEqual({});
    expect(untouched.user).toBeUndefined();
  });

  it('returns nothing when the model fails', async () => {
    const failing: TextModel = {
      name: 'down',
      external: false,
      complete: async () => {
        throw new Error('timeout');
      },
    };
    expect(await interpretText(failing, 'someone funny')).toEqual({});
  });

  it('taps win over the reading; interests add up', () => {
    expect(
      mergeChoices(
        { looking: 'short_term', enjoy: ['art'] },
        { looking: 'long_term', distance: 'near', enjoy: ['art', 'wine'] },
      ),
    ).toEqual({ looking: 'short_term', distance: 'near', enjoy: ['art', 'wine'] });
  });
});
