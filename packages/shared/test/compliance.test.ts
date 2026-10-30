// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  incidentDatesInOrder,
  incidentInputSchema,
  incidentNotifyBy,
  transparencyCsv,
  transparencyQuerySchema,
  type TransparencyReport,
} from '../src/index.js';

describe('compliance kit (phase 64)', () => {
  it('a report period: from ≤ to, at most a year', () => {
    expect(
      transparencyQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success,
    ).toBe(true);
    expect(
      transparencyQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-01' }).success,
    ).toBe(true);
    expect(
      transparencyQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success,
    ).toBe(false);
    expect(
      transparencyQuerySchema.safeParse({ from: '2025-01-01', to: '2026-06-01' }).success,
    ).toBe(false);
    expect(transparencyQuerySchema.safeParse({ from: '1 Jan', to: '2026-01-01' }).success).toBe(
      false,
    );
  });

  const incident = {
    title: 'Laptop lost',
    kind: 'lost_device',
    severity: 'high',
    discoveredAt: '2026-10-29T08:00:00Z',
    description: 'Disk encrypted.\nRemote wipe sent.',
  };

  it('incidents: plain text with line breaks, known kinds, dates in order', () => {
    const parsed = incidentInputSchema.parse(incident);
    expect(parsed).toMatchObject({ occurredAt: null, affectedMembers: null, closedAt: null });
    for (const bad of [
      { ...incident, description: 'see <a href="x">here</a>' },
      { ...incident, title: 'x'.repeat(121) },
      { ...incident, title: '   ' },
      { ...incident, kind: 'aliens' },
      { ...incident, affectedMembers: -1 },
      { ...incident, occurredAt: '2026-10-30T00:00:00Z' }, // found before it happened
      { ...incident, discoveredAt: '2026-10-29' }, // a moment, not a day
      { ...incident, email: 'someone@example.test' },
    ]) {
      expect(incidentInputSchema.safeParse(bad).success).toBe(false);
    }
    const dates = {
      occurredAt: null,
      discoveredAt: '2026-10-29T08:00:00Z',
      authorityNotifiedAt: '2026-10-29T07:00:00Z',
      membersNotifiedAt: null,
      closedAt: null,
    };
    expect(incidentDatesInOrder(dates)).toBe(false);
    expect(incidentDatesInOrder({ ...dates, authorityNotifiedAt: '2026-10-30T07:00:00Z' })).toBe(
      true,
    );
  });

  it('the 72-hour mark: high and severe incidents, until the authority is notified', () => {
    const at = { discoveredAt: '2026-10-29T08:00:00.000Z', authorityNotifiedAt: null };
    expect(incidentNotifyBy({ ...at, severity: 'severe' })).toBe('2026-11-01T08:00:00.000Z');
    expect(incidentNotifyBy({ ...at, severity: 'high' })).toBe('2026-11-01T08:00:00.000Z');
    expect(incidentNotifyBy({ ...at, severity: 'medium' })).toBeNull();
    expect(
      incidentNotifyBy({ ...at, severity: 'severe', authorityNotifiedAt: '2026-10-30T00:00:00Z' }),
    ).toBeNull();
  });

  it('the CSV: one number per row, empty for unknown medians', () => {
    const zero = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, 0]));
    const report = {
      period: { from: '2026-01-01', to: '2026-06-30' },
      generatedAt: '2026-07-01T00:00:00.000Z',
      notices: {
        total: 3,
        bySource: { members: 2, automatic: 1, partners: 0 },
        byCategory: zero(['underage', 'threat', 'harassment', 'scam']),
        closed: { actioned: 1, dismissed: 1 },
        medianHoursToDecision: null,
      },
      decisions: {
        total: 1,
        byAction: { warn: 1, suspend: 0, ban: 0 },
        byGround: { terms: 1, illegal: 0 },
        automatedDetection: 0,
        reversed: 0,
      },
      appeals: {
        received: 0,
        byStatus: { open: 0, upheld: 0, reversed: 0 },
        medianDaysToDecide: 2.5,
      },
      underageSuspensions: 0,
      membersActiveLast30Days: 12,
      retentionNote: 'n/a',
    } as unknown as TransparencyReport;
    const lines = transparencyCsv(report).trimEnd().split('\r\n');
    expect(lines[0]).toBe('section,item,value');
    expect(lines).toContain('notices_by_source,members,2');
    expect(lines).toContain('notices,median_hours_to_decision,');
    expect(lines).toContain('appeals,median_days_to_decide,2.5');
    expect(lines).toContain('accounts,members_active_last_30_days,12');
    expect(lines.every((l) => l.split(',').length === 3)).toBe(true);
  });
});
