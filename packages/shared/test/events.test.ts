// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { eventInputSchema, eventUpdateSchema } from '../src/events.js';

const base = {
  title: 'Picnic in the park',
  venueId: '6f1c2a59-1b8c-4d8e-9b8a-2d0b6a4f1c3e',
  startsAt: '2026-11-01T10:00:00.000Z',
  endsAt: '2026-11-01T13:00:00.000Z',
};

describe('event input', () => {
  it('fills defaults: empty description, no capacity, a regular event', () => {
    expect(eventInputSchema.parse(base)).toEqual({
      ...base,
      description: '',
      capacity: null,
      kind: 'standard',
      roundMinutes: null,
      pools: null,
      revealHours: null,
      tableSize: null,
    });
  });

  it('phase 71b: who it is for and places by gender', () => {
    const parse = (over: object) => eventInputSchema.safeParse({ ...base, ...over });
    expect(parse({ audience: { genders: ['woman'], ageMin: 25, ageMax: 35 } }).success).toBe(true);
    expect(parse({ audience: { ageMin: 40, ageMax: 30 } }).success).toBe(false);
    expect(parse({ audience: { ageMin: 17 } }).success).toBe(false);
    expect(parse({ audience: { faithStreams: ['not_a_stream'] } }).success).toBe(false);
    const pools = (p: object[]) => parse({ pools: p }).success;
    expect(
      pools([
        { gender: 'woman', capacity: 12 },
        { gender: 'man', capacity: 12 },
      ]),
    ).toBe(true);
    expect(pools([{ gender: 'woman', capacity: 12 }])).toBe(false);
    expect(
      pools([
        { gender: 'woman', capacity: 1 },
        { gender: 'woman', capacity: 2 },
      ]),
    ).toBe(false);
    // Speed dating: the places by gender add up to at most 40.
    const speed = (p: object[]) =>
      parse({ kind: 'speed', capacity: null, roundMinutes: 5, pools: p }).success;
    expect(
      speed([
        { gender: 'woman', capacity: 20 },
        { gender: 'man', capacity: 20 },
      ]),
    ).toBe(true);
    expect(
      speed([
        { gender: 'woman', capacity: 21 },
        { gender: 'man', capacity: 20 },
      ]),
    ).toBe(false);
  });

  it('speed dating needs a capacity of at most 40 and rounds of 3 to 10 minutes', () => {
    const speed = (over: object) =>
      eventInputSchema.safeParse({ ...base, kind: 'speed', capacity: 20, ...over }).success;
    expect(speed({ roundMinutes: 5 })).toBe(true);
    expect(speed({ capacity: null })).toBe(false);
    expect(speed({ capacity: 41 })).toBe(false);
    expect(speed({ roundMinutes: 2 })).toBe(false);
    expect(speed({ roundMinutes: 11 })).toBe(false);
    expect(speed({ kind: 'party' })).toBe(false);
  });

  it('allows line breaks in the description but not in the title', () => {
    expect(eventInputSchema.safeParse({ ...base, description: 'Line one\nLine two' }).success).toBe(
      true,
    );
    expect(eventInputSchema.safeParse({ ...base, title: 'Picnic\nin the park' }).success).toBe(
      false,
    );
  });

  it('refuses an end before the start, more than 24 hours, odd capacities and extra fields', () => {
    const refuse = (over: object) => eventInputSchema.safeParse({ ...base, ...over }).success;
    expect(refuse({ endsAt: '2026-11-01T09:00:00.000Z' })).toBe(false);
    expect(refuse({ endsAt: '2026-11-02T10:00:01.000Z' })).toBe(false);
    expect(refuse({ capacity: 1 })).toBe(false);
    expect(refuse({ capacity: 2.5 })).toBe(false);
    expect(refuse({ attendees: [] })).toBe(false);
  });
});

describe('event update', () => {
  it('needs at least one field and checks the window when both ends change', () => {
    expect(eventUpdateSchema.safeParse({}).success).toBe(false);
    expect(eventUpdateSchema.parse({ capacity: null })).toEqual({ capacity: null });
    expect(
      eventUpdateSchema.safeParse({ startsAt: base.endsAt, endsAt: base.startsAt }).success,
    ).toBe(false);
  });
});
