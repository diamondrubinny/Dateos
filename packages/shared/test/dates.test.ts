// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  datePlanSummary,
  proposeDateSchema,
  venueInputSchema,
  venueUpdateSchema,
} from '../src/dates.js';

const place = {
  name: 'Café Puaa',
  area: 'Jaffa',
  category: 'cafe',
  address: 'Rabbi Yohanan St 8',
};

describe('venue input', () => {
  it('fills defaults and trims', () => {
    expect(venueInputSchema.parse({ ...place, name: '  Café Puaa ' })).toEqual({
      ...place,
      note: null,
      stepFree: false,
      active: true,
    });
  });

  it('refuses line breaks, unknown categories, coordinates and empty updates', () => {
    expect(venueInputSchema.safeParse({ ...place, area: 'Jaffa\r\nTel Aviv' }).success).toBe(false);
    expect(venueInputSchema.safeParse({ ...place, category: 'home' }).success).toBe(false);
    expect(venueInputSchema.safeParse({ ...place, lat: 32 }).success).toBe(false);
    expect(venueUpdateSchema.safeParse({}).success).toBe(false);
    expect(venueUpdateSchema.parse({ active: false })).toEqual({ active: false });
  });
});

describe('date proposal', () => {
  const base = {
    venueId: '6f1c2a59-1b8c-4d8e-9b8a-2d0b6a4f1c3e',
    startsAt: '2026-10-25T17:00:00.000Z',
    clientId: 'date-12345',
  };

  it('accepts a proposal with or without a note', () => {
    expect(proposeDateSchema.parse(base)).toEqual(base);
    expect(proposeDateSchema.parse({ ...base, note: ' See you! ' }).note).toBe('See you!');
  });

  it('refuses bad ids, long notes and extra fields', () => {
    expect(proposeDateSchema.safeParse({ ...base, clientId: 'a b' }).success).toBe(false);
    expect(proposeDateSchema.safeParse({ ...base, note: 'x'.repeat(201) }).success).toBe(false);
    expect(proposeDateSchema.safeParse({ ...base, address: 'my flat' }).success).toBe(false);
  });
});

describe('date card summary (report evidence)', () => {
  it('names the place, the time in UTC and the note', () => {
    const startsAt = new Date('2026-10-25T17:00:00Z');
    expect(
      datePlanSummary({ venueName: 'Café Puaa', venueArea: 'Jaffa', startsAt, note: 'Coffee?' }),
    ).toBe('📅 Café Puaa, Jaffa · 2026-10-25 17:00 UTC · Coffee?');
    expect(
      datePlanSummary({ venueName: 'Café Puaa', venueArea: 'Jaffa', startsAt, note: null }),
    ).toBe('📅 Café Puaa, Jaffa · 2026-10-25 17:00 UTC');
  });
});
