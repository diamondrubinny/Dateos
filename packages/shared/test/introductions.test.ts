// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  firstToHear,
  introductionInputSchema,
  matchmakersCsv,
  type MatchmakerRow,
} from '../src/index.js';

describe('introductions (phase 68a)', () => {
  const woman = { id: 'w', gender: 'woman' };
  const man = { id: 'm', gender: 'man' };
  const nonbinary = { id: 'n', gender: 'nonbinary' };

  it('women first: the woman when exactly one of the two is a woman; otherwise both', () => {
    expect(firstToHear('together', woman, man)).toBeNull();
    expect(firstToHear('women_first', man, woman)).toBe('w');
    expect(firstToHear('women_first', woman, nonbinary)).toBe('w');
    expect(firstToHear('women_first', woman, { id: 'w2', gender: 'woman' })).toBeNull();
    expect(firstToHear('women_first', man, nonbinary)).toBeNull();
  });

  it('a note: plain text, two different members', () => {
    const ok = { aId: 'a', bId: 'b', note: 'You both love hiking' };
    expect(introductionInputSchema.safeParse(ok).success).toBe(true);
    expect(introductionInputSchema.safeParse({ ...ok, bId: 'a' }).success).toBe(false);
    expect(introductionInputSchema.safeParse({ ...ok, note: '<b>hi</b>' }).success).toBe(false);
    expect(introductionInputSchema.safeParse({ ...ok, note: ' ' }).success).toBe(false);
    expect(introductionInputSchema.safeParse({ ...ok, note: 'x'.repeat(301) }).success).toBe(false);
  });

  it('the report as CSV: counts only, formulas defused', () => {
    const row: MatchmakerRow = {
      userId: 'u',
      displayName: '=HYPERLINK("x")',
      since: '2026-10-01T08:00:00.000Z',
      introductions: 5,
      matches: 2,
      met: 2,
      engaged: 1,
      married: 0,
    };
    expect(matchmakersCsv([row])).toBe(
      'matchmaker,since,introductions,matches,met,engaged,married\n' +
        '"\'=HYPERLINK(""x"")",2026-10-01,5,2,2,1,0\n',
    );
  });
});
