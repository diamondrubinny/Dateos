// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  APPEAL_WINDOW_DAYS,
  appealDeadline,
  appealInputSchema,
  decideAppealSchema,
  resolveReportSchema,
} from '../src/moderation.js';

describe('decisions and appeals (phase 61)', () => {
  it('a warning, suspension or ban needs an explanation for the member; dismissing doesn’t', () => {
    const base = { reason: 'internal note' };
    expect(resolveReportSchema.safeParse({ ...base, action: 'dismiss' }).success).toBe(true);
    for (const action of ['warn', 'suspend', 'ban'] as const) {
      expect(resolveReportSchema.safeParse({ ...base, action }).success).toBe(false);
      expect(
        resolveReportSchema.safeParse({ ...base, action, explanation: '   short   ' }).success,
      ).toBe(false);
      const ok = resolveReportSchema.parse({
        ...base,
        action,
        explanation: 'Messages you sent broke the rules.',
      });
      expect(ok.ground).toBe('terms'); // the default ground
    }
    expect(
      resolveReportSchema.safeParse({
        ...base,
        action: 'warn',
        explanation: 'x'.repeat(1001),
      }).success,
    ).toBe(false);
    expect(
      resolveReportSchema.safeParse({
        ...base,
        action: 'warn',
        ground: 'other',
        explanation: 'Messages you sent broke the rules.',
      }).success,
    ).toBe(false);
  });

  it('the appeal window is at least six months (DSA Art. 20(1))', () => {
    expect(APPEAL_WINDOW_DAYS).toBeGreaterThanOrEqual(183);
    const decided = new Date('2026-01-31T12:00:00Z');
    expect(appealDeadline(decided).toISOString()).toBe('2026-08-02T12:00:00.000Z');
  });

  it('an appeal and a reply have sensible lengths; text is trimmed', () => {
    expect(appealInputSchema.safeParse({ text: '   long enough ' }).success).toBe(true);
    expect(appealInputSchema.safeParse({ text: '   too short ' }).success).toBe(false); // 9 once trimmed
    expect(appealInputSchema.safeParse({ text: '  short  ' }).success).toBe(false);
    expect(appealInputSchema.parse({ text: '  Please look again.  ' }).text).toBe(
      'Please look again.',
    );
    expect(appealInputSchema.safeParse({ text: 'x'.repeat(1001) }).success).toBe(false);
    expect(decideAppealSchema.safeParse({ reverse: true, response: 'ok' }).success).toBe(false);
    expect(
      decideAppealSchema.safeParse({ reverse: 'yes', response: 'We looked again.' }).success,
    ).toBe(false);
  });
});
