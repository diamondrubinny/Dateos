// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { INTRODUCTIONS_DAILY } from '@nexaheart/shared';
import { strFromU8, unzipSync } from 'fflate';
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

describe.skipIf(!integrationEnabled)('community matchmakers, phase 68a (integration)', () => {
  let ctx: TestContext;
  let admin: Member;
  let rina: Member; // the matchmaker
  let noa: Member;
  let dan: Member;
  let eli: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));

  const open = (m: Member) => api(ctx, m, 'PUT', '/v1/me/settings', { openToMatchmakers: true });
  const emailOf = async (m: Member) =>
    (await q('SELECT email FROM "user" WHERE id = $1', [m.id])).rows[0].email as string;

  beforeEach(async () => {
    await resetState(ctx);
    ctx.jobs.push.length = 0;
    const email = 'intro-admin@example.test';
    const cookie = await signIn(ctx, email);
    await q(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
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
    admin = { cookie } as Member;
    rina = await createMember(ctx, { name: 'Rina', gender: 'woman', interestedIn: ['man'] });
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
    for (const m of [noa, dan, eli]) await open(m);
  });

  const grant = async (m: Member) =>
    api(ctx, admin, 'POST', '/v1/admin/matchmakers', { email: await emailOf(m) });
  const introduce = (a: Member, b: Member, by: Member = rina) =>
    api(ctx, by, 'POST', '/v1/introductions', {
      aId: a.id,
      bId: b.id,
      note: 'You both love long walks',
    });
  const mine = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me/introductions')).json();
  const answer = (m: Member, id: string, a: 'yes' | 'no') =>
    api(ctx, m, 'PUT', `/v1/introductions/${id}/answer`, { answer: a });
  const order = (introductionOrder: string) =>
    api(ctx, admin, 'PATCH', '/v1/admin/instance', { introductionOrder });
  const pushesTo = (m: Member) =>
    ctx.jobs.push.filter((j) => j.kind === 'introduction' && j.userId === m.id).length;

  it('admins name matchmakers; the badge is public; only members who opted in are listed', async () => {
    expect((await api(ctx, rina, 'GET', '/v1/introductions/console')).statusCode).toBe(403);
    expect((await introduce(noa, dan)).statusCode).toBe(403);
    expect((await grant(rina)).statusCode).toBe(200);
    expect((await grant(rina)).statusCode).toBe(200); // twice is fine
    expect(
      (await api(ctx, admin, 'POST', '/v1/admin/matchmakers', { email: 'nobody@example.test' }))
        .statusCode,
    ).toBe(404);
    // Only admins.
    expect(
      (
        await api(ctx, rina, 'POST', '/v1/admin/matchmakers', {
          email: await emailOf(rina),
        })
      ).statusCode,
    ).toBe(403);
    const badge = (await api(ctx, dan, 'GET', `/v1/profiles/${rina.id}`)).json();
    expect(badge.matchmakerSince).toEqual(expect.any(String));
    expect((await mine(rina)).matchmakerSince).toEqual(expect.any(String));

    await api(ctx, eli, 'PUT', '/v1/me/settings', { openToMatchmakers: false });
    const listed = (await api(ctx, rina, 'GET', '/v1/introductions/console')).json();
    expect(listed.members.map((m: { id: string }) => m.id).sort()).toEqual([noa.id, dan.id].sort());
    expect(listed.members[0]).toEqual(
      expect.objectContaining({ age: expect.any(Number), photoUrl: expect.any(String) }),
    );
    expect(listed.left).toBe(INTRODUCTIONS_DAILY);
    const filtered = (
      await api(ctx, rina, 'GET', '/v1/introductions/console?gender=man&q=da')
    ).json();
    expect(filtered.members.map((m: { id: string }) => m.id)).toEqual([dan.id]);
    // A matchmaker sees a listed member's profile and photo, as any member would.
    expect((await api(ctx, rina, 'GET', `/v1/profiles/${dan.id}`)).statusCode).toBe(200);
    expect((await api(ctx, rina, 'GET', `/v1/photos/${dan.photoId}`)).statusCode).toBe(200);
    // Not a dating candidate of Rina's: visible to her only while open to matchmakers.
    const maya = await createMember(ctx, { name: 'Maya', gender: 'woman', interestedIn: ['man'] });
    expect((await api(ctx, rina, 'GET', `/v1/profiles/${maya.id}`)).statusCode).toBe(404);
    await open(maya);
    expect((await api(ctx, rina, 'GET', `/v1/profiles/${maya.id}`)).statusCode).toBe(200);
    // Searches are audited, without the text.
    const { rows } = await q(
      `SELECT meta FROM audit_logs WHERE action = 'matchmaker.search' ORDER BY created_at`,
    );
    expect(rows.length).toBe(2);
    expect(rows[0].meta).toEqual({ results: 2 });
    expect(JSON.stringify(rows)).not.toContain('da');
  });

  it('together: both hear, two yeses open a chat; credit for the matchmaker', async () => {
    await grant(rina);
    const res = await introduce(noa, dan);
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    expect([pushesTo(noa), pushesTo(dan)]).toEqual([1, 1]);
    const forNoa = (await mine(noa)).received[0];
    expect(forNoa).toMatchObject({
      id,
      note: 'You both love long walks',
      matchmaker: { displayName: 'Rina', since: expect.any(String) },
      other: { id: dan.id, displayName: 'Dan' },
      myAnswer: null,
      state: 'open',
    });
    expect((await answer(noa, id, 'yes')).json()).toEqual({ state: 'open', matchId: null });
    expect((await answer(noa, id, 'yes')).statusCode).toBe(404); // once
    expect((await mine(dan)).received[0]).toMatchObject({ myAnswer: null, state: 'open' });
    const both = (await answer(dan, id, 'yes')).json();
    expect(both).toEqual({ state: 'matched', matchId: expect.any(String) });
    const matches = (await api(ctx, noa, 'GET', '/v1/matches')).json();
    expect(JSON.stringify(matches)).toContain(both.matchId);
    // Credit, only by the two.
    expect(
      (await api(ctx, eli, 'PUT', `/v1/introductions/${id}/outcome`, { outcome: 'met' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx, noa, 'PUT', `/v1/introductions/${id}/outcome`, { outcome: 'engaged' }))
        .statusCode,
    ).toBe(200);
    const sent = (await api(ctx, rina, 'GET', '/v1/introductions/console')).json().sent;
    expect(sent[0]).toMatchObject({ id, state: 'matched', outcome: 'engaged' });
    expect(JSON.stringify(sent)).not.toContain('yes');
    const report = (await api(ctx, admin, 'GET', '/v1/admin/matchmakers')).json();
    expect(report.matchmakers).toEqual([
      expect.objectContaining({
        displayName: 'Rina',
        introductions: 1,
        matches: 1,
        met: 1,
        engaged: 1,
        married: 0,
      }),
    ]);
    const empty = (
      await api(ctx, admin, 'GET', '/v1/admin/matchmakers?from=2000-01-01&to=2000-12-31')
    ).json();
    expect(empty.matchmakers[0]).toMatchObject({ introductions: 0, matches: 0 });
  });

  it('women first: the man hears only after her yes', async () => {
    await grant(rina);
    expect((await order('women_first')).statusCode).toBe(200);
    const id = (await introduce(dan, noa)).json().id as string;
    expect([pushesTo(noa), pushesTo(dan)]).toEqual([1, 0]);
    expect((await mine(dan)).received).toEqual([]);
    expect((await answer(dan, id, 'yes')).statusCode).toBe(404);
    expect((await mine(noa)).received).toHaveLength(1);
    await answer(noa, id, 'yes');
    expect(pushesTo(dan)).toBe(1);
    expect((await mine(dan)).received[0]).toMatchObject({ id, other: { id: noa.id } });
    expect((await answer(dan, id, 'yes')).json().state).toBe('matched');
  });

  it('a no is never revealed: "waiting" until it expires, then "didn\'t go ahead"', async () => {
    await grant(rina);
    await order('women_first');
    // Women first: her no means he never hears of it.
    const first = (await introduce(dan, noa)).json().id as string;
    await answer(noa, first, 'no');
    expect((await mine(noa)).received[0]).toMatchObject({ myAnswer: 'no', state: 'closed' });
    expect((await mine(dan)).received).toEqual([]);
    expect((await api(ctx, rina, 'GET', '/v1/introductions/console')).json().sent[0].state).toBe(
      'open',
    );
    // Together: Eli's no leaves Noa's yes "open", for her and the matchmaker, until it expires.
    await order('together');
    const second = (await introduce(noa, eli)).json().id as string;
    await answer(noa, second, 'yes');
    await answer(eli, second, 'no');
    const noaView = (await mine(noa)).received.find((r: { id: string }) => r.id === second);
    expect(noaView).toMatchObject({ myAnswer: 'yes', state: 'open' });
    await q(`UPDATE introductions SET expires_at = now() - interval '1 second'`);
    const later = (await mine(noa)).received.find((r: { id: string }) => r.id === second);
    expect(later.state).toBe('closed');
    const sent = (await api(ctx, rina, 'GET', '/v1/introductions/console')).json().sent;
    expect(sent.map((s: { state: string }) => s.state)).toEqual(['closed', 'closed']);
    // And the two can't be introduced again, by anyone.
    expect((await introduce(noa, eli)).statusCode).toBe(409);
  });

  it("pairs that can't be introduced all get the same answer", async () => {
    await grant(rina);
    const refused = async (a: Member, b: Member) => {
      const res = await introduce(a, b);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toBe("These two can't be introduced right now.");
    };
    await refused(noa, rina); // the matchmaker themself
    await refused(dan, eli); // not each other's dating rules
    await api(ctx, eli, 'PUT', '/v1/me/settings', { openToMatchmakers: false });
    await refused(noa, eli); // not opted in
    await open(eli);
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: eli.id, kind: 'pass' });
    await refused(noa, eli); // a pass
    await api(ctx, noa, 'POST', `/v1/blocks`, { userId: dan.id });
    await refused(noa, dan); // a block
    const zoe = await createMember(ctx, { name: 'Zoe', gender: 'woman', interestedIn: ['man'] });
    await open(zoe);
    expect((await introduce(zoe, dan)).statusCode).toBe(200);
    await refused(dan, zoe); // already open (either order)
    // A daily limit.
    await q(
      `INSERT INTO introductions (matchmaker_id, a_id, b_id, note, expires_at)
       SELECT $1, $2, $3, 'x', now() FROM generate_series(1, $4)`,
      [rina.id, zoe.id, eli.id, INTRODUCTIONS_DAILY],
    );
    expect((await introduce(zoe, eli)).statusCode).toBe(429);
  });

  it('taking the role back closes open introductions; the badge goes', async () => {
    await grant(rina);
    const id = (await introduce(noa, dan)).json().id as string;
    expect((await api(ctx, admin, 'DELETE', `/v1/admin/matchmakers/${rina.id}`)).statusCode).toBe(
      200,
    );
    expect((await mine(noa)).received[0]).toMatchObject({
      state: 'closed',
      matchmaker: { displayName: 'Rina', since: null },
    });
    expect((await answer(noa, id, 'yes')).statusCode).toBe(404);
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${rina.id}`)).json().matchmakerSince).toBe(
      null,
    );
    expect((await api(ctx, rina, 'GET', '/v1/introductions/console')).statusCode).toBe(403);
    const { rows } = await q(
      `SELECT action, meta FROM audit_logs WHERE action LIKE 'matchmaker.%' ORDER BY created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual(['matchmaker.granted', 'matchmaker.revoked']);
    expect(rows[1].meta).toEqual({ closed: 1 });
  });

  it('settings and "Download my data"', async () => {
    expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().openToMatchmakers).toBe(true);
    await grant(rina);
    const id = (await introduce(noa, dan)).json().id as string;
    await answer(noa, id, 'yes');
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.introductions.received).toEqual([
      expect.objectContaining({ id, yourAnswer: 'yes' }),
    ]);
    expect(JSON.stringify(data.introductions)).not.toContain(dan.id);
    const rinaZip = await api(ctx, rina, 'GET', '/v1/me/export');
    const rinaData = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(rinaZip.rawPayload))['data.json']!),
    );
    expect(rinaData.introductions.matchmakerSince).toEqual(expect.any(String));
    expect(rinaData.introductions.sentAsMatchmaker).toEqual([
      expect.objectContaining({ id, note: 'You both love long walks' }),
    ]);
    expect(JSON.stringify(rinaData.introductions)).not.toContain('yes');
  });
});
