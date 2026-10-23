// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { checkInCode } from '../src/modules/events/service.js';
import { pairRound } from '../src/modules/speed/service.js';

const ids = (...names: string[]) => names.map((id) => ({ id, sat: 0 }));
const fixed = () => 0.5;

describe('speed-dating rounds', () => {
  it('pairs everyone it can, each person once', () => {
    const pairs = pairRound(ids('a', 'b', 'c', 'd'), () => true, fixed);
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.flat()).size).toBe(4);
  });

  it('only pairs people who may meet', () => {
    const allowed = new Set(['a|c', 'b|d']);
    const canMeet = (x: string, y: string) => allowed.has([x, y].sort().join('|'));
    const pairs = pairRound(ids('a', 'b', 'c', 'd'), canMeet, fixed).map((p) => p.sort().join('|'));
    expect(pairs.sort()).toEqual(['a|c', 'b|d']);
  });

  it('lets the person with the fewest options choose first, so fewer sit out', () => {
    // a can only meet b; b and c could meet anyone. Greedy by name would pair b-c and leave a out.
    const allowed = new Set(['a|b', 'b|c', 'c|d', 'b|d']);
    const canMeet = (x: string, y: string) => allowed.has([x, y].sort().join('|'));
    const pairs = pairRound(ids('b', 'c', 'a', 'd'), canMeet, fixed).map((p) => p.sort().join('|'));
    expect(pairs.sort()).toEqual(['a|b', 'c|d']);
  });

  it('puts people who sat out first', () => {
    const people = [
      { id: 'a', sat: 0 },
      { id: 'b', sat: 0 },
      { id: 'c', sat: 2 },
    ];
    const pairs = pairRound(people, () => true, fixed);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toContain('c');
  });

  it('returns no pairs when nobody may meet', () => {
    expect(pairRound(ids('a', 'b'), () => false, fixed)).toEqual([]);
    expect(pairRound(ids('a'), () => true, fixed)).toEqual([]);
  });
});

describe('check-in codes', () => {
  const secret = 'ab'.repeat(32);
  it('are 6 digits, change every window and depend on the secret', () => {
    const code = checkInCode(secret, 1000);
    expect(code).toMatch(/^\d{6}$/);
    expect(checkInCode(secret, 1000)).toBe(code);
    expect(checkInCode(secret, 1001)).not.toBe(code);
    expect(checkInCode('cd'.repeat(32), 1000)).not.toBe(code);
  });
});
