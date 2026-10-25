// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  FEDERATION_CONSENT_VERSION,
  type FederatedMatch,
  type FederatedProfile,
  type ReportDetail,
} from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OUTBOX_GIVE_UP_MS } from '../../src/modules/federation/service.js';
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
import { A_URL, B_URL, bridge } from './two-servers.js';

describe.skipIf(!integrationEnabled)('partner communities: safety (integration)', () => {
  let a: TestContext;
  let b: TestContext;
  /** Community B can be taken offline, to test the outbox. */
  let bDown = false;
  const qa = (sql: string, params: unknown[] = []) => a.services.dbHandle.pool.query(sql, params);
  const qb = (sql: string, params: unknown[] = []) => b.services.dbHandle.pool.query(sql, params);

  beforeAll(async () => {
    const toB = bridge(B_URL, () => b);
    a = await setupIntegration({
      federation: true,
      apiUrl: A_URL,
      fetch: (async (input: URL | string, init?: RequestInit) => {
        if (bDown) throw new Error('connect ECONNREFUSED');
        return toB(input, init);
      }) as typeof fetch,
    });
    b = await setupIntegration({
      federation: true,
      second: { suffix: 'b', redisDb: 14, apiUrl: B_URL },
      fetch: bridge(A_URL, () => a),
    });
  });
  afterAll(async () => {
    if (a) await teardown(a);
    if (b) await teardown(b);
  });

  let noa: Member;
  let dan: Member;
  let adminA: { id: string; cookie: string };
  let adminB: { id: string; cookie: string };
  let partnerAtA: string;
  let partnerAtB: string;
  let danCard: FederatedProfile;

  const idOf = async (ctx: TestContext, cookie: string) =>
    (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json().user
      .id as string;
  /** A signed-in admin with two-step sign-in set up, as the dashboard requires. */
  async function admin(ctx: TestContext, q: typeof qa, email: string) {
    const cookie = await signIn(ctx, email);
    await q(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });
    return { id: await idOf(ctx, cookie), cookie };
  }
  const asAdmin = (
    ctx: TestContext,
    who: { cookie: string },
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
  ) =>
    ctx.app.inject({
      method,
      url,
      headers: { cookie: who.cookie },
      ...(payload ? { payload } : {}),
    });

  beforeEach(async () => {
    bDown = false;
    await resetState(a);
    await resetState(b);
    adminA = await admin(a, qa, 'admin-a@example.test');
    adminB = await admin(b, qb, 'admin-b@example.test');
    await a.services.federation.invite(adminA.id, B_URL);
    partnerAtB = (await b.services.federation.list()).partners[0]!.id;
    await b.services.federation.accept(adminB.id, partnerAtB);
    partnerAtA = (await a.services.federation.list()).partners[0]!.id;
    noa = await createMember(a, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(b, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    for (const [ctx, m] of [
      [a, noa],
      [b, dan],
    ] as const) {
      await api(ctx, m, 'POST', '/v1/federated/join', { version: FEDERATION_CONSENT_VERSION });
    }
    danCard = ((await api(a, noa, 'GET', '/v1/federated/deck')).json() as FederatedProfile[])[0]!;
  });

  async function matchAndChat() {
    await api(a, noa, 'POST', '/v1/federated/interactions', {
      partnerId: danCard.partnerId,
      alias: danCard.alias,
      kind: 'like',
    });
    const [noaCard] = (await api(b, dan, 'GET', '/v1/federated/deck')).json() as FederatedProfile[];
    await api(b, dan, 'POST', '/v1/federated/interactions', {
      partnerId: noaCard!.partnerId,
      alias: noaCard!.alias,
      kind: 'like',
    });
    const [atA] = (await api(a, noa, 'GET', '/v1/federated/matches')).json() as FederatedMatch[];
    const [atB] = (await api(b, dan, 'GET', '/v1/federated/matches')).json() as FederatedMatch[];
    await api(a, noa, 'POST', `/v1/federated/matches/${atA!.id}/messages`, {
      text: 'Hi Dan',
      clientId: 'safety-1-hello',
    });
    await api(b, dan, 'POST', `/v1/federated/matches/${atB!.id}/messages`, {
      text: 'You owe me, send me money now or else',
      clientId: 'safety-2-threat',
    });
  }

  it('a report reaches the reported person’s own queue; only "reviewed" comes back', async () => {
    await matchAndChat();
    const sent = await api(a, noa, 'POST', '/v1/federated/reports', {
      partnerId: danCard.partnerId,
      alias: danCard.alias,
      category: 'threat',
      details: 'He threatened me.',
    });
    expect(sent.statusCode, sent.body).toBe(201);
    // Reporting blocks too: the match ends on both sides.
    expect((await api(a, noa, 'GET', '/v1/federated/matches')).json()).toEqual([]);
    expect((await api(b, dan, 'GET', '/v1/federated/matches')).json()).toEqual([]);

    // B's moderators see it in their queue, from a member of community A, with the evidence.
    const queue = await asAdmin(b, adminB, 'GET', '/v1/admin/reports?status=open');
    expect(queue.statusCode, queue.body).toBe(200);
    const [summary] = queue.json().reports as { id: string; category: string; priority: string }[];
    expect(summary).toMatchObject({ category: 'threat', priority: 'urgent' });
    const detail = (
      await asAdmin(b, adminB, 'GET', `/v1/admin/reports/${summary!.id}`)
    ).json() as ReportDetail;
    expect(detail.partnerCommunity).toBe('NexaHeart');
    expect(detail.reporter).toEqual({ id: null, displayName: null });
    expect(detail.details).toBe('He threatened me.');
    expect(detail.evidence.map((e) => [e.from, e.body])).toEqual([
      ['reporter', 'Hi Dan'],
      ['reported', 'You owe me, send me money now or else'],
    ]);
    // Urgent: B's staff are emailed, with no content.
    expect(b.mail.some((m) => /urgent report/i.test(m.subject))).toBe(true);
    // A second report on the same person is refused.
    const again = await api(a, noa, 'POST', '/v1/federated/reports', {
      partnerId: danCard.partnerId,
      alias: danCard.alias,
      category: 'scam',
    });
    expect(again.statusCode).toBe(409);

    // B suspends Dan; A learns only that it was reviewed.
    const resolved = await asAdmin(b, adminB, 'POST', `/v1/admin/reports/${summary!.id}/resolve`, {
      action: 'suspend',
      reason: 'Threats, confirmed by the chat.',
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const row = (await qa('SELECT reviewed_at FROM federation_reports_out')).rows[0];
    expect(row.reviewed_at).not.toBeNull();
    const partners = (await a.services.federation.list()).partners;
    expect(partners[0]!.reports).toEqual({ sent: 1, reviewed: 1, received: 0 });
    expect((await b.services.federation.list()).partners[0]!.reports).toEqual({
      sent: 0,
      reviewed: 0,
      received: 1,
    });
    // A never stores what was decided.
    expect(JSON.stringify((await qa('SELECT * FROM federation_reports_out')).rows)).not.toContain(
      'suspend',
    );
  });

  it('suspending a partner stops everything both ways without deleting; resume brings it back', async () => {
    await matchAndChat();
    const suspended = await asAdmin(a, adminA, 'POST', `/v1/admin/partners/${partnerAtA}/suspend`);
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(suspended.json().partners[0].status).toBe('suspended');
    // Nothing from B here, nothing from here to B.
    expect((await api(a, noa, 'GET', '/v1/federated/deck')).json()).toEqual([]);
    expect((await api(a, noa, 'GET', '/v1/federated/matches')).json()).toEqual([]);
    expect((await api(b, dan, 'GET', '/v1/federated/deck')).json()).toEqual([]);
    const [atB] = (await api(b, dan, 'GET', '/v1/federated/matches')).json() as FederatedMatch[];
    expect(
      (
        await api(b, dan, 'POST', `/v1/federated/matches/${atB!.id}/messages`, {
          text: 'Hello?',
          clientId: 'safety-3-while-suspended',
        })
      ).statusCode,
    ).toBe(502);
    // Nothing was deleted.
    expect((await qa('SELECT count(*)::int AS n FROM federation_messages')).rows[0].n).toBe(2);
    // Moderators can't decide; only admins.
    await qa(`UPDATE "user" SET role = 'moderator' WHERE id = $1`, [adminA.id]);
    expect(
      (await asAdmin(a, adminA, 'POST', `/v1/admin/partners/${partnerAtA}/resume`)).statusCode,
    ).toBe(403);
    await qa(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [adminA.id]);
    const resumed = await asAdmin(a, adminA, 'POST', `/v1/admin/partners/${partnerAtA}/resume`);
    expect(resumed.json().partners[0].status).toBe('active');
    expect((await api(a, noa, 'GET', '/v1/federated/matches')).json()).toHaveLength(1);
    const audit = await qa(
      `SELECT action FROM audit_logs WHERE action LIKE 'federation.%' ORDER BY created_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['federation.suspend', 'federation.resume']),
    );
  });

  it('what can’t reach a partner waits in the outbox and is retried', async () => {
    await matchAndChat();
    bDown = true;
    // Noa leaves while B is unreachable: A forgets her now; B is told later.
    await api(a, noa, 'POST', '/v1/federated/leave');
    expect((await qa('SELECT count(*)::int AS n FROM federation_outbox')).rows[0].n).toBe(1);
    expect((await a.services.federation.list()).partners[0]!.outbox).toBe(1);
    expect((await qb('SELECT count(*)::int AS n FROM federation_matches')).rows[0].n).toBe(1);

    // Not due yet: nothing happens. Due but still down: a longer pause.
    expect(await a.services.federation.drainOutbox()).toEqual({ sent: 0, retry: 0, dropped: 0 });
    a.clock.value += 61_000;
    expect(await a.services.federation.drainOutbox()).toEqual({ sent: 0, retry: 1, dropped: 0 });
    const pending = (await qa('SELECT attempts, next_attempt_at FROM federation_outbox')).rows[0];
    expect(pending.attempts).toBe(2);
    expect(new Date(pending.next_attempt_at).getTime()).toBe(a.clock.value + 120_000);

    // B is back: delivered, and B forgets Noa.
    bDown = false;
    a.clock.value += 121_000;
    b.clock.value = a.clock.value;
    expect(await a.services.federation.drainOutbox()).toEqual({ sent: 1, retry: 0, dropped: 0 });
    expect((await qa('SELECT count(*)::int AS n FROM federation_outbox')).rows[0].n).toBe(0);
    expect((await qb('SELECT count(*)::int AS n FROM federation_matches')).rows[0].n).toBe(0);
    expect((await qb('SELECT count(*)::int AS n FROM federation_messages')).rows[0].n).toBe(0);
  });

  it('gives up after 7 days, and notes it in the audit log', async () => {
    bDown = true;
    await api(a, noa, 'POST', '/v1/federated/reports', {
      partnerId: danCard.partnerId,
      alias: danCard.alias,
      category: 'spam',
    });
    expect((await qa('SELECT path FROM federation_outbox')).rows).toEqual([
      { path: '/v1/federation/reports' },
    ]);
    a.clock.value += OUTBOX_GIVE_UP_MS;
    expect(await a.services.federation.drainOutbox()).toEqual({ sent: 0, retry: 0, dropped: 1 });
    expect((await qa('SELECT count(*)::int AS n FROM federation_outbox')).rows[0].n).toBe(0);
    const dropped = await qa(
      `SELECT meta FROM audit_logs WHERE action = 'federation.outbox_dropped'`,
    );
    expect(dropped.rows[0].meta).toMatchObject({ path: '/v1/federation/reports' });
    // Ending a partnership clears the outbox too.
    await api(a, noa, 'POST', '/v1/federated/leave');
    await a.services.federation.end(adminA.id, partnerAtA);
    expect((await qa('SELECT count(*)::int AS n FROM federation_outbox')).rows[0].n).toBe(0);
  });

  it('refuses reports from strangers and malformed reports', async () => {
    const unsigned = await b.app.inject({
      method: 'POST',
      url: '/v1/federation/reports',
      payload: {},
    });
    expect(unsigned.statusCode).toBe(401);
    await expect(
      a.services.federation.send(B_URL, 'POST', '/v1/federation/reports', { id: 'x' }),
    ).rejects.toThrow(/400/);
    // Reporting someone from a community we aren't connected to.
    const res = await api(a, noa, 'POST', '/v1/federated/reports', {
      partnerId: '00000000-0000-4000-8000-000000000000',
      alias: danCard.alias,
      category: 'spam',
    });
    expect(res.statusCode).toBe(404);
  });
});
