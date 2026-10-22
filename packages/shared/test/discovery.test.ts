// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { distanceBucket, interactionInputSchema, snapToGrid } from '../src/index.js';

/** Haversine distance in km. */
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

describe('snapToGrid', () => {
  const telAviv = { lat: 32.0809, lng: 34.7806 };

  it('moves coordinates to a cell centre at most ~0.75 km away', () => {
    const snapped = snapToGrid(telAviv.lat, telAviv.lng);
    expect(km(telAviv, snapped)).toBeLessThan(0.75);
  });

  it('gives everyone in the same cell identical coordinates (limits trilateration)', () => {
    const a = snapToGrid(32.0809, 34.7806);
    const b = snapToGrid(32.0812, 34.781); // ~50 m away
    expect(a).toEqual(b);
  });

  it('is stable: snapping a snapped point changes nothing', () => {
    const once = snapToGrid(telAviv.lat, telAviv.lng);
    expect(snapToGrid(once.lat, once.lng)).toEqual(once);
  });

  it('keeps cells roughly square at high latitudes and handles the antimeridian', () => {
    const oslo = snapToGrid(59.9139, 10.7522);
    expect(km({ lat: 59.9139, lng: 10.7522 }, oslo)).toBeLessThan(0.75);
    const east = snapToGrid(10, 179.9999);
    expect(east.lng).toBeLessThanOrEqual(180);
    expect(east.lng).toBeGreaterThanOrEqual(-180);
  });
});

describe('distanceBucket', () => {
  it('never exposes exact distances', () => {
    expect([0.4, 1.9, 2, 7, 24.9, 49, 300].map(distanceBucket)).toEqual([
      'lt2',
      'lt2',
      'lt5',
      'lt10',
      'lt25',
      'lt50',
      'gt50',
    ]);
  });
});

describe('interactionInputSchema', () => {
  it('only lets likes carry comments and requires itemType with itemId', () => {
    expect(
      interactionInputSchema.safeParse({ targetId: 'u', kind: 'pass', comment: 'hi' }).success,
    ).toBe(false);
    expect(
      interactionInputSchema.safeParse({
        targetId: 'u',
        kind: 'like',
        itemId: '00000000-0000-4000-8000-000000000000',
      }).success,
    ).toBe(false);
    expect(
      interactionInputSchema.safeParse({ targetId: 'u', kind: 'like', comment: '  Nice!  ' }).data
        ?.comment,
    ).toBe('Nice!');
  });
});
