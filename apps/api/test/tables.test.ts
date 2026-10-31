// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { TableAnswers } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import { assignTables, type Seat } from '../src/modules/events/tables.js';

const calm: TableAnswers = { pace: 'calm', talk: 'deep', drinks: 'no_alcohol' };
const lively: TableAnswers = { pace: 'lively', talk: 'light', drinks: 'alcohol' };
const seat = (id: string, gender: string, answers: TableAnswers): Seat => ({ id, gender, answers });
const tablesOf = (m: Map<string, number>) => {
  const t = new Map<number, string[]>();
  for (const [id, n] of m) t.set(n, [...(t.get(n) ?? []), id]);
  return [...t.entries()].sort(([a], [b]) => a - b).map(([, ids]) => ids.sort());
};

describe('tables by questionnaire (phase 71d)', () => {
  it('nobody: no tables', () => {
    expect(assignTables([], 6).size).toBe(0);
  });

  it('sizes differ by at most one, and each table mixes the genders evenly', () => {
    const people = [
      ...Array.from({ length: 7 }, (_, i) => seat(`w${i}`, 'woman', i < 4 ? calm : lively)),
      ...Array.from({ length: 6 }, (_, i) => seat(`m${i}`, 'man', i < 3 ? calm : lively)),
    ];
    const tables = tablesOf(assignTables(people, 6));
    expect(tables).toHaveLength(3); // 13 people, tables of about 6
    const sizes = tables.map((t) => t.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    for (const t of tables) {
      expect(t.filter((id) => id.startsWith('m')).length).toBe(2);
    }
  });

  it('people with similar answers sit together', () => {
    const people = [
      ...['a', 'b', 'c'].map((id) => seat(`w${id}`, 'woman', calm)),
      ...['d', 'e', 'f'].map((id) => seat(`w${id}`, 'woman', lively)),
      ...['a', 'b', 'c'].map((id) => seat(`m${id}`, 'man', calm)),
      ...['d', 'e', 'f'].map((id) => seat(`m${id}`, 'man', lively)),
    ];
    const tables = tablesOf(assignTables(people, 6));
    expect(tables).toEqual([
      ['ma', 'mb', 'mc', 'wa', 'wb', 'wc'],
      ['md', 'me', 'mf', 'wd', 'we', 'wf'],
    ]);
  });

  it('is the same every time', () => {
    const people = Array.from({ length: 9 }, (_, i) =>
      seat(`p${i}`, i % 3 === 0 ? 'nonbinary' : i % 2 ? 'man' : 'woman', i % 2 ? calm : lively),
    );
    expect([...assignTables(people, 4)]).toEqual([...assignTables([...people].reverse(), 4)]);
  });
});
