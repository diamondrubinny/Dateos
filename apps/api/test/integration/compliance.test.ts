// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const EXPLANATION = 'Several messages to another member were insulting.';

describe.skipIf(!integrationEnabled)('compliance kit, phase 64 (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let admin: Member & { id: string };
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));

  async function staff(role: 'moderator' | 'admin') {
    const email = `${role}-compliance-${(n += 1)}@example.test`;
    const cookie = await signIn(ctx, email);
    await q(`UPDATE "user" SET role = $2 WHERE email = $1`, [email, role]);
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    ctx.clock.value += 30_000;
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });
    const { rows } = await q('SELECT id FROM "user" WHERE email = $1', [email]);
    return { id: rows[0].id as string, cookie } as Member & { id: string };
  }

  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    admin = await staff('admin');
  });

  /** The database's today, since rows get their time from the database. */
  const today = async () => (await q(`SELECT current_date::text AS d`)).rows[0].d as string;
  const shift = (day: string, days: number) =>
    new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
  /** Each notice from a different member (a member can report someone once). */
  const report = async (category = 'harassment') => {
    const reporter = await createMember(ctx, {
      name: `Reporter${(n += 1)}`,
      gender: 'woman',
      interestedIn: ['man'],
    });
    const res = await api(ctx, reporter, 'POST', '/v1/reports', {
      targetId: dan.id,
      category,
      block: false,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().reportId as string;
  };
  const transparency = (from: string, to: string, by: Member = admin) =>
    api(ctx, by, 'GET', `/v1/admin/compliance/transparency?from=${from}&to=${to}`);

  it('the transparency report counts notices, decisions, automatic detection, reversals and appeals in the period', async () => {
    const day = await today();
    const first = await report('harassment');
    const second = await report('scam');
    await q('UPDATE reports SET automatic = true WHERE id = $1', [first]);
    await report('harassment'); // still open
    // An older notice, outside the period.
    const old = await report('threat');
    await q(`UPDATE reports SET created_at = now() - interval '40 days' WHERE id = $1`, [old]);
    for (const [id, action] of [
      [first, 'warn'],
      [second, 'dismiss'],
    ] as const) {
      const res = await api(ctx, admin, 'POST', `/v1/admin/reports/${id}/resolve`, {
        action,
        reason: 'internal note',
        explanation: EXPLANATION,
        ground: 'terms',
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    // Dan appeals the warning; a second admin reverses it.
    const decision = (await api(ctx, dan, 'GET', '/v1/me/decisions')).json().decisions[0];
    await api(ctx, dan, 'POST', `/v1/me/decisions/${decision.id}/appeal`, {
      text: 'I was quoting a song, not insulting anyone.',
    });
    const other = await staff('admin');
    const [appeal] = (await api(ctx, other, 'GET', '/v1/admin/appeals?status=open')).json().appeals;
    const decided = await api(ctx, other, 'POST', `/v1/admin/appeals/${appeal.id}/decide`, {
      reverse: true,
      response: 'You’re right: the warning is withdrawn.',
    });
    expect(decided.statusCode).toBe(200);

    const res = await transparency(shift(day, -6), day);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notices).toMatchObject({
      total: 3,
      bySource: { members: 2, automatic: 1, partners: 0 },
      byCategory: expect.objectContaining({ harassment: 2, scam: 1, threat: 0 }),
      closed: { actioned: 1, dismissed: 1 },
    });
    expect(body.notices.medianHoursToDecision).toBeTypeOf('number');
    expect(body.decisions).toMatchObject({
      total: 1, // dismissing a notice isn't a decision against anyone
      byAction: { warn: 1, suspend: 0, ban: 0 },
      byGround: { terms: 1, illegal: 0 },
      automatedDetection: 1,
      reversed: 1,
    });
    expect(body.appeals).toMatchObject({
      received: 1,
      byStatus: { open: 0, upheld: 0, reversed: 1 },
    });
    expect(body.membersActiveLast30Days).toBeGreaterThanOrEqual(2);
    // Counts only: no ids, names or text anywhere in it.
    const text = JSON.stringify(body);
    for (const secret of [dan.id, noa.id, 'Noa', 'Dan', EXPLANATION, 'internal note']) {
      expect(text).not.toContain(secret);
    }
    // The earlier period has only the old notice.
    const earlier = (await transparency(shift(day, -60), shift(day, -30))).json();
    expect(earlier.notices.total).toBe(1);
    expect(earlier.decisions.total).toBe(0);
  });

  it('the period makes sense; moderators can’t use the compliance kit', async () => {
    const day = await today();
    expect((await transparency(day, shift(day, -1))).statusCode).toBe(400);
    expect((await transparency(shift(day, -400), day)).statusCode).toBe(400);
    expect((await transparency('yesterday', day)).statusCode).toBe(400);
    const mod = await staff('moderator');
    expect((await transparency(day, day, mod)).statusCode).toBe(403);
    expect((await api(ctx, mod, 'GET', '/v1/admin/compliance/incidents')).statusCode).toBe(403);
    expect(
      (await api(ctx, mod, 'GET', '/v1/admin/compliance/templates/security-statement')).statusCode,
    ).toBe(403);
    // Members, of course, neither.
    expect((await transparency(day, day, noa)).statusCode).toBe(403);
  });

  it('security incidents: recorded, updated, audited, never deleted; the 72-hour mark', async () => {
    const discoveredAt = '2026-10-29T08:00:00.000Z';
    const created = await api(ctx, admin, 'POST', '/v1/admin/compliance/incidents', {
      title: 'Backup bucket was public for two hours',
      kind: 'data_leak',
      severity: 'severe',
      occurredAt: '2026-10-29T06:00:00.000Z',
      discoveredAt,
      affectedMembers: 120,
      description: 'A storage rule change made the backup bucket readable.\nReverted at 08:10.',
    });
    expect(created.statusCode).toBe(201);
    const incident = created.json();
    expect(incident.notifyBy).toBe('2026-11-01T08:00:00.000Z');
    expect(incident.actions).toBeNull();

    // Refused: markup, found before it happened, notified before it was found, unknown fields.
    const base = {
      title: 'x',
      kind: 'other',
      severity: 'low',
      discoveredAt,
      description: 'Something',
    };
    for (const bad of [
      { ...base, description: '<script>alert(1)</script>' },
      { ...base, occurredAt: '2026-10-30T00:00:00.000Z' },
      { ...base, severity: 'catastrophic' },
      { ...base, reporter: 'dan@example.test' },
    ]) {
      expect(
        (await api(ctx, admin, 'POST', '/v1/admin/compliance/incidents', bad)).statusCode,
      ).toBe(400);
    }
    const patch = (body: Record<string, unknown>) =>
      api(ctx, admin, 'PATCH', `/v1/admin/compliance/incidents/${incident.id}`, body);
    // Against the saved incident: notified before it was found.
    expect((await patch({ authorityNotifiedAt: '2026-10-28T00:00:00.000Z' })).statusCode).toBe(400);

    const updated = await patch({
      authorityNotifiedAt: '2026-10-30T09:00:00.000Z',
      actions: 'Bucket made private; keys rotated; members told by email.',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      notifyBy: null,
      authorityNotifiedAt: '2026-10-30T09:00:00.000Z',
      title: 'Backup bucket was public for two hours',
    });
    // A low-severity incident has no 72-hour mark.
    const low = (await api(ctx, admin, 'POST', '/v1/admin/compliance/incidents', base)).json();
    expect(low.notifyBy).toBeNull();

    const list = (await api(ctx, admin, 'GET', '/v1/admin/compliance/incidents')).json().incidents;
    expect(list.map((i: { id: string }) => i.id)).toEqual(
      expect.arrayContaining([incident.id, low.id]),
    );
    // Audited (the fields that changed, never their text); no way to delete.
    const { rows } = await q(
      `SELECT action, meta FROM audit_logs WHERE target_id = $1 ORDER BY created_at`,
      [incident.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['incident.created', 'incident.updated']);
    expect(rows[1].meta).toEqual({ fields: 'actions,authorityNotifiedAt' });
    expect(
      (await api(ctx, admin, 'DELETE', `/v1/admin/compliance/incidents/${incident.id}`)).statusCode,
    ).toBe(404);
    expect(
      (
        await api(
          ctx,
          admin,
          'PATCH',
          '/v1/admin/compliance/incidents/00000000-0000-4000-8000-000000000000',
          {
            title: 'x',
          },
        )
      ).statusCode,
    ).toBe(404);
  });

  it('the Audit page can show staff access to member data only', async () => {
    const id = await report();
    expect((await api(ctx, admin, 'GET', `/v1/admin/reports/${id}`)).statusCode).toBe(200);
    await api(ctx, admin, 'POST', '/v1/admin/compliance/incidents', {
      title: 'Laptop lost',
      kind: 'lost_device',
      severity: 'medium',
      discoveredAt: '2026-10-29T08:00:00.000Z',
      description: 'Disk encrypted.',
    });
    const all = (await api(ctx, admin, 'GET', '/v1/admin/audit')).json().entries;
    expect(all.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['staff.report_viewed', 'incident.created']),
    );
    const access = (await api(ctx, admin, 'GET', '/v1/admin/audit?only=staff_access')).json()
      .entries;
    expect(access.length).toBeGreaterThan(0);
    expect(access.every((e: { action: string }) => e.action.startsWith('staff.'))).toBe(true);
    expect(access.some((e: { action: string }) => e.action === 'staff.mfa_failed')).toBe(false);
    expect((await api(ctx, admin, 'GET', '/v1/admin/audit?only=everything')).statusCode).toBe(400);
  });

  it('templates follow the settings and are drafts, in English and Hebrew', async () => {
    const get = (name: string, locale = 'en') =>
      api(ctx, admin, 'GET', `/v1/admin/compliance/templates/${name}?locale=${locale}`);
    await api(ctx, admin, 'PATCH', '/v1/admin/instance', {
      operatorName: 'Rainbow Club Ltd',
      contactEmail: 'privacy@example.test',
    });
    const statement = await get('security-statement');
    expect(statement.statusCode).toBe(200);
    expect(statement.headers['content-type']).toContain('text/markdown');
    expect(statement.headers['content-disposition']).toBe(
      'attachment; filename="security-statement.en.md"',
    );
    expect(statement.body).toContain('DRAFT');
    expect(statement.body).toContain('Rainbow Club Ltd');
    expect(statement.body).toContain('privacy@example.test');
    expect(statement.body).not.toContain('Faith and observance');
    expect(statement.body).not.toContain('Age checks are done');
    expect(statement.body).toContain('No partner communities');

    await api(ctx, admin, 'PATCH', '/v1/admin/instance', { faithModule: true, joinMinAge: 50 });
    const withFaith = await get('security-statement');
    expect(withFaith.body).toContain('Faith and observance');
    const risks = (await get('risk-assessment')).body;
    expect(risks).toContain('Minimum age 50');
    expect(risks).toContain('older members are targeted more often');
    expect(risks).toContain('Exposure of faith or observance');

    const hebrew = await get('security-statement', 'he');
    expect(hebrew.body).toContain('טיוטה');
    expect(hebrew.body).toContain('תשובות על דת');
    expect((await get('no-paid-features', 'he')).body).toContain("בלי פיצ'רים בתשלום");
    expect((await get('no-paid-features')).body).toContain('No paid features');
    expect((await get('privacy-policy')).statusCode).toBe(400);
    expect((await get('security-statement', 'fr')).statusCode).toBe(400);
  });
});
