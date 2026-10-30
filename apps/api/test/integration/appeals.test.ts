// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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

const EXPLANATION = 'Several messages to another member were insulting.';
const NOTE = 'internal: second complaint this month';

describe.skipIf(!integrationEnabled)('decisions and appeals, phase 61 (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
  });

  type Method = 'GET' | 'POST';
  interface Staff {
    id: string;
    cookie: string;
    call: (method: Method, url: string, payload?: unknown) => ReturnType<typeof api>;
  }
  async function staff(role: 'moderator' | 'admin'): Promise<Staff> {
    const email = `${role}-appeals-${(n += 1)}@example.test`;
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
    return {
      id: rows[0].id,
      cookie,
      call: (method, url, payload) => api(ctx, { cookie } as Member, method, url, payload),
    };
  }
  const report = async (category = 'harassment') =>
    (
      await api(ctx, noa, 'POST', '/v1/reports', { targetId: dan.id, category, block: false })
    ).json().reportId as string;
  const decide = (
    by: Staff,
    reportId: string,
    action: 'warn' | 'suspend' | 'ban' | 'dismiss',
    extra: Record<string, unknown> = { explanation: EXPLANATION },
  ) => by.call('POST', `/v1/admin/reports/${reportId}/resolve`, { action, reason: NOTE, ...extra });
  /** Dan again, after a suspension revoked his sessions. */
  const danBack = async () => {
    const { rows } = await q('SELECT email FROM "user" WHERE id = $1', [dan.id]);
    const cookie = await signIn(ctx, rows[0].email);
    return { ...dan, cookie };
  };
  const decisions = async (m: Member) =>
    (await api(ctx, m, 'GET', '/v1/me/decisions')).json().decisions as Record<string, unknown>[];
  const appealsQueue = async (by: Staff, status = 'open') =>
    (await by.call('GET', `/v1/admin/appeals?status=${status}`)).json().appeals as {
      id: string;
      canDecide: boolean;
      [k: string]: unknown;
    }[];

  it('a warning, suspension or ban needs an explanation for the member; dismissing doesn’t', async () => {
    const mod = await staff('moderator');
    const id = await report();
    for (const extra of [{}, { explanation: 'short' }]) {
      const res = await decide(mod, id, 'warn', extra);
      expect(res.statusCode).toBe(400);
    }
    expect((await decide(mod, id, 'dismiss', {})).statusCode).toBe(200);
  });

  it('the statement of reasons: what, why and the ground, never the internal note or who', async () => {
    const mod = await staff('moderator');
    const id = await report();
    await q('UPDATE reports SET automatic = true WHERE id = $1', [id]);
    expect(
      (await decide(mod, id, 'warn', { explanation: EXPLANATION, ground: 'illegal' })).statusCode,
    ).toBe(200);
    const list = await decisions(dan);
    expect(list).toEqual([
      expect.objectContaining({
        action: 'warn',
        category: 'harassment',
        ground: 'illegal',
        explanation: EXPLANATION,
        automatedDetection: true,
        reversed: false,
        canAppeal: true,
        appeal: null,
      }),
    ]);
    const until = new Date(list[0]!.appealUntil as string).getTime();
    const at = new Date(list[0]!.createdAt as string).getTime();
    expect(Math.round((until - at) / 86_400_000)).toBe(183);
    const text = JSON.stringify(list);
    for (const leak of ['internal', mod.id, noa.id, 'Noa']) expect(text).not.toContain(leak);
    // The warning notice links to it.
    const me = (await api(ctx, dan, 'GET', '/v1/me')).json();
    expect(me.notices).toEqual([
      expect.objectContaining({ kind: 'warning', decisionId: list[0]!.id }),
    ]);
    // Nobody else sees it.
    expect(await decisions(noa)).toEqual([]);
  });

  it('a suspended member reads why and appeals; an admin reverses it and they are back', async () => {
    const mod = await staff('moderator');
    const boss = await staff('admin');
    await decide(mod, await report(), 'suspend');
    const back = await danBack();
    const [decision] = await decisions(back);
    expect(decision).toMatchObject({ action: 'suspend', canAppeal: true });
    const mailBefore = ctx.mail.length;
    const appeal = await api(ctx, back, 'POST', `/v1/me/decisions/${decision!.id}/appeal`, {
      text: 'I was quoting a film, not insulting anyone. Please look again.',
    });
    expect(appeal.statusCode).toBe(201);
    // Staff hear that an appeal is waiting; the email has no content.
    const alerts = ctx.mail.slice(mailBefore);
    expect(alerts.map((m) => m.subject)).toEqual(
      expect.arrayContaining([expect.stringContaining('an appeal is waiting')]),
    );
    expect(JSON.stringify(alerts)).not.toContain('quoting a film');
    // Once per decision, and only one's own.
    const again = await api(ctx, back, 'POST', `/v1/me/decisions/${decision!.id}/appeal`, {
      text: 'Second try at the same appeal.',
    });
    expect(again.statusCode).toBe(409);
    const notMine = await api(ctx, noa, 'POST', `/v1/me/decisions/${decision!.id}/appeal`, {
      text: 'This is not my decision at all.',
    });
    expect(notMine.statusCode).toBe(404);
    expect((await decisions(back))[0]).toMatchObject({
      canAppeal: false,
      appeal: { status: 'open', response: null },
    });
    expect((await boss.call('GET', '/v1/admin/overview')).json().appealsWaiting).toBe(1);

    // The moderator who suspended can't decide it, nor can any moderator for a suspension.
    const [waiting] = await appealsQueue(mod);
    expect(waiting).toMatchObject({
      canDecide: false,
      text: 'I was quoting a film, not insulting anyone. Please look again.',
      decision: expect.objectContaining({ reason: NOTE, explanation: EXPLANATION }),
    });
    const reply = {
      reverse: true,
      response: 'We looked again: the quote was not aimed at anyone.',
    };
    expect(
      (await mod.call('POST', `/v1/admin/appeals/${waiting!.id}/decide`, reply)).statusCode,
    ).toBe(403);

    const [forBoss] = await appealsQueue(boss);
    expect(forBoss!.canDecide).toBe(true);
    const mailBeforeDecision = ctx.mail.length;
    expect(
      (await boss.call('POST', `/v1/admin/appeals/${waiting!.id}/decide`, reply)).statusCode,
    ).toBe(200);
    expect(
      (await boss.call('POST', `/v1/admin/appeals/${waiting!.id}/decide`, reply)).statusCode,
    ).toBe(409);

    // Back: the account works again.
    const { rows } = await q('SELECT status, suspended_reason FROM "user" WHERE id = $1', [dan.id]);
    expect(rows[0]).toEqual({ status: 'active', suspended_reason: null });
    expect((await api(ctx, back, 'GET', '/v1/matches')).statusCode).toBe(200);
    // The member is emailed that it was reviewed, without the outcome or the reply.
    const sent = ctx.mail.slice(mailBeforeDecision);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('Your appeal was reviewed');
    expect(JSON.stringify(sent[0])).not.toContain('quote was not aimed');
    // And reads the answer in the app.
    const me = (await api(ctx, back, 'GET', '/v1/me')).json();
    const notice = me.notices.find((x: { kind: string }) => x.kind === 'appeal_decided');
    expect(notice).toMatchObject({ outcome: 'reversed', decisionId: decision!.id });
    expect((await decisions(back))[0]).toMatchObject({
      reversed: true,
      canAppeal: false,
      appeal: { status: 'reversed', response: reply.response },
    });
    expect((await api(ctx, back, 'POST', `/v1/me/notices/${notice.id}/ack`)).statusCode).toBe(200);
    const after = (await api(ctx, back, 'GET', '/v1/me')).json();
    expect(after.notices.some((x: { kind: string }) => x.kind === 'appeal_decided')).toBe(false);
    // Audited.
    const audited = await q(
      `SELECT action FROM audit_logs WHERE action LIKE 'appeal.%' ORDER BY created_at`,
    );
    expect(audited.rows.map((r) => r.action)).toEqual(['appeal.created', 'appeal.reversed']);
    expect((await appealsQueue(boss)).length).toBe(0);
    expect((await appealsQueue(boss, 'closed'))[0]).toMatchObject({ status: 'reversed' });
  });

  it('upheld: the suspension stays; the person who decided can’t review it unless the only admin', async () => {
    const first = await staff('admin');
    const second = await staff('admin');
    await decide(first, await report('scam'), 'ban');
    const back = await danBack();
    const [decision] = await decisions(back);
    await api(ctx, back, 'POST', `/v1/me/decisions/${decision!.id}/appeal`, {
      text: 'I never asked anyone for money.',
    });
    const [waiting] = await appealsQueue(first);
    expect(waiting!.canDecide).toBe(false);
    const uphold = { reverse: false, response: 'The messages asked for a gift card twice.' };
    expect(
      (await first.call('POST', `/v1/admin/appeals/${waiting!.id}/decide`, uphold)).statusCode,
    ).toBe(403);
    expect(
      (await second.call('POST', `/v1/admin/appeals/${waiting!.id}/decide`, uphold)).statusCode,
    ).toBe(200);
    const { rows } = await q('SELECT status, suspended_reason FROM "user" WHERE id = $1', [dan.id]);
    expect(rows[0]).toEqual({ status: 'suspended', suspended_reason: 'banned' });
    expect((await decisions(back))[0]).toMatchObject({
      reversed: false,
      appeal: { status: 'upheld', response: uphold.response },
    });
  });

  it('a community’s only admin may review their own decision', async () => {
    const only = await staff('admin');
    await decide(only, await report(), 'warn');
    const [decision] = await decisions(dan);
    await api(ctx, dan, 'POST', `/v1/me/decisions/${decision!.id}/appeal`, {
      text: 'It was a misunderstanding between us.',
    });
    const [waiting] = await appealsQueue(only);
    expect(waiting!.canDecide).toBe(true);
    const res = await only.call('POST', `/v1/admin/appeals/${waiting!.id}/decide`, {
      reverse: true,
      response: 'Agreed, we withdrew the warning.',
    });
    expect(res.statusCode).toBe(200);
    // A withdrawn warning is no longer shown as a warning.
    const me = (await api(ctx, dan, 'GET', '/v1/me')).json();
    expect(me.notices.map((x: { kind: string }) => x.kind)).toEqual(['appeal_decided']);
  });

  it('not after six months', async () => {
    const mod = await staff('moderator');
    await decide(mod, await report(), 'warn');
    await q(`UPDATE moderation_actions SET created_at = now() - interval '184 days'`);
    const [decision] = await decisions(dan);
    expect(decision!.canAppeal).toBe(false);
    const res = await api(ctx, dan, 'POST', `/v1/me/decisions/${decision!.id}/appeal`, {
      text: 'Late, but I would like to appeal.',
    });
    expect(res.statusCode).toBe(409);
  });

  it('reversing an older suspension leaves a later ban in force', async () => {
    const mod = await staff('moderator');
    const boss = await staff('admin');
    await decide(mod, await report(), 'suspend');
    const back = await danBack();
    const [suspension] = await decisions(back);
    await api(ctx, back, 'POST', `/v1/me/decisions/${suspension!.id}/appeal`, {
      text: 'Please review the suspension.',
    });
    await boss.call('POST', `/v1/admin/users/${dan.id}/unsuspend`, { reason: 'served' });
    // Banned later for something else (noa reports again).
    await q(`UPDATE reports SET status = 'actioned'`);
    const { rows: again } = await q(
      `INSERT INTO reports (reporter_id, reported_id, category, priority) VALUES ($1, $2, 'scam', 'high') RETURNING id`,
      [noa.id, dan.id],
    );
    expect((await decide(boss, again[0].id, 'ban')).statusCode).toBe(200);
    const [waiting] = await appealsQueue(boss);
    await boss.call('POST', `/v1/admin/appeals/${waiting!.id}/decide`, {
      reverse: true,
      response: 'The first suspension was too strict.',
    });
    const { rows } = await q('SELECT status, suspended_reason FROM "user" WHERE id = $1', [dan.id]);
    expect(rows[0]).toEqual({ status: 'suspended', suspended_reason: 'banned' });
  });

  it('"Download my data" has the decisions as told to me and my appeals, not the note', async () => {
    const mod = await staff('moderator');
    await decide(mod, await report(), 'warn');
    const [decision] = await decisions(dan);
    await api(ctx, dan, 'POST', `/v1/me/decisions/${decision!.id}/appeal`, {
      text: 'My side of the story, in full.',
    });
    const zip = await api(ctx, dan, 'GET', '/v1/me/export');
    const json = strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!);
    const data = JSON.parse(json);
    expect(data.moderationAffectingYou[0]).toMatchObject({
      action: 'warn',
      explanation: EXPLANATION,
      ground: 'terms',
    });
    expect(data.appeals[0]).toMatchObject({
      text: 'My side of the story, in full.',
      status: 'open',
    });
    expect(json).not.toContain('internal:');
  });
});
