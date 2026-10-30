// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { dealbreakersSchema } from '../src/about.js';
import { faithInputSchema, questionsFor, streamsFor } from '../src/faith.js';
import { partnerIntention, partnerIntentions } from '../src/federation.js';

describe('faith module and marriage (phase 62b)', () => {
  it('streams and observance questions belong to their faith', () => {
    expect(streamsFor('jewish')).toContain('dati_leumi');
    expect(streamsFor('druze')).toEqual([]);
    expect(streamsFor(null)).toEqual([]);
    expect(questionsFor('jewish')).toEqual(['shabbat', 'kashrut', 'negiah']);
    expect(questionsFor('muslim')).toEqual(['halal', 'prayer']);
    expect(questionsFor('none')).toEqual([]);
    const ok = (v: unknown) => faithInputSchema.safeParse(v).success;
    expect(ok({ faith: 'jewish', stream: 'haredi', observance: { shabbat: 'yes' } })).toBe(true);
    expect(ok({ faith: 'jewish', stream: 'shia', observance: {} })).toBe(false);
    expect(ok({ faith: 'christian', stream: null, observance: { kashrut: 'yes' } })).toBe(false);
    expect(ok({ faith: null, stream: 'reform', observance: {} })).toBe(false);
    expect(ok({ faith: 'muslim', stream: null, observance: { halal: 'maybe' } })).toBe(false);
    expect(ok({ faith: null, stream: null, observance: {} })).toBe(true); // clearing
  });

  it('older clients without the new dealbreakers still validate (they default to any)', () => {
    const d = dealbreakersSchema.parse({
      smokingOk: [],
      childrenOk: [],
      religionOk: [],
      heightMin: null,
      heightMax: null,
    });
    expect(d).toMatchObject({ faithOk: [], streamOk: [] });
  });

  it('marriage travels to partner communities as long-term', () => {
    expect(partnerIntention('marriage')).toBe('long_term');
    expect(partnerIntention('friends')).toBe('friends');
    expect(partnerIntentions(['marriage', 'long_term', 'open'])).toEqual(['long_term', 'open']);
  });
});
