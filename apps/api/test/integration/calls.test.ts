// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processCalls } from '../../../worker/src/call-jobs.js';
import { purgeClosedChats } from '../../../worker/src/profile-jobs.js';
import type { Env } from '../../src/config/env.js';
import { type CallMedia, createLiveKitMedia } from '../../src/lib/livekit.js';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  TEST_LIVEKIT,
  type TestContext,
} from './setup.js';

/** A well-formed X25519 public key (base64url); the server never interprets it. */
const PK = 'q1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v';

/** Real tokens and webhook signatures; only the room API calls are recorded instead of sent. */
const rooms = { created: [] as string[], deleted: [] as string[] };
const real = createLiveKitMedia(TEST_LIVEKIT as unknown as Env)!;
const media: CallMedia = {
  ...real,
  createRoom: async (room) => void rooms.created.push(room),
  deleteRoom: async (room) => void rooms.deleted.push(room),
};

/** What LiveKit would POST: the body, signed with the API secret (sha256 of the exact body). */
async function signedWebhook(event: string, room: string, identity?: string) {
  const body = JSON.stringify({
    event,
    room: { name: room },
    ...(identity ? { participant: { identity } } : {}),
    id: `EV_${Math.random().toString(36).slice(2)}`,
    createdAt: String(Math.floor(Date.now() / 1000)),
  });
  const token = new AccessToken(TEST_LIVEKIT.LIVEKIT_API_KEY, TEST_LIVEKIT.LIVEKIT_API_SECRET);
  token.sha256 = createHash('sha256').update(body).digest('base64');
  return { body, authorization: await token.toJwt() };
}

describe.skipIf(!integrationEnabled)('video dates (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const enable = (maxMinutes = 60) =>
    q(
      `INSERT INTO instance_settings (id, calls_enabled, call_max_minutes) VALUES (1, true, $1)
       ON CONFLICT (id) DO UPDATE SET calls_enabled = true, call_max_minutes = $1`,
      [maxMinutes],
    );
  const say = (m: Member, text: string) =>
    api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
      text,
      clientId: `msg-${(n += 1)}-xxxx`,
    });
  async function unlock() {
    for (let i = 0; i < 3; i += 1) {
      await say(noa, `Hi ${i}`);
      await say(dan, `Hello ${i}`);
    }
  }
  const call = (m: Member, video = true) =>
    api(ctx, m, 'POST', `/v1/matches/${matchId}/calls`, { video });
  const sweep = () =>
    processCalls({
      db: ctx.services.dbHandle.db,
      deleteRoom: async (room) => void rooms.deleted.push(room),
      publish: async () => undefined,
      now: () => new Date(ctx.clock.value),
    });
  const callRow = async (id: string) =>
    (await q('SELECT * FROM calls WHERE id = $1', [id])).rows[0] as Record<string, unknown>;

  async function admin() {
    const email = `admin-${(n += 1)}@example.test`;
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
    return cookie;
  }

  beforeAll(async () => {
    ctx = await setupIntegration({ callMedia: media });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    // Messages get the database's clock, so the API's clock starts at the real time here.
    ctx.clock.value = Date.now();
    rooms.created.length = 0;
    rooms.deleted.length = 0;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;
  });

  it('is off until an admin turns it on; the admin setting is audited', async () => {
    await unlock();
    expect((await call(noa)).statusCode).toBe(503);
    const page = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`)).json();
    expect(page.callsAvailable).toBe(false);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json().calls).toBe(false);

    const cookie = await admin();
    const settings = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/instance',
      headers: { cookie },
    });
    expect(settings.json()).toMatchObject({ callsConfigured: true, callsEnabled: false });
    for (const bad of [{ callMaxMinutes: 2 }, { callMaxMinutes: 500 }]) {
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/admin/instance',
        headers: { cookie },
        payload: bad,
      });
      expect(res.statusCode).toBe(400);
    }
    const on = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/instance',
      headers: { cookie },
      payload: { callsEnabled: true, callMaxMinutes: 30 },
    });
    expect(on.json()).toMatchObject({ callsEnabled: true, callMaxMinutes: 30 });
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json().calls).toBe(true);
    const { rows } = await q(
      `SELECT meta FROM audit_logs WHERE action = 'instance.updated' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0].meta.fields).toBe('callMaxMinutes,callsEnabled');
    // Members can't change it.
    const member = await api(ctx, noa, 'PATCH', '/v1/admin/instance', { callsEnabled: false });
    expect(member.statusCode).toBe(403);

    const res = await call(noa);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'ringing', video: true, mine: true });
  });

  it('only in an unlocked chat, only participants, and only if the other person accepts calls', async () => {
    await enable();
    expect((await call(noa)).statusCode).toBe(403); // not unlocked yet
    await unlock();
    const page = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`)).json();
    expect(page.callsAvailable).toBe(true);

    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await call(eve)).statusCode).toBe(404);

    expect((await api(ctx, dan, 'PUT', '/v1/me/settings', { acceptCalls: false })).statusCode).toBe(
      200,
    );
    expect((await api(ctx, dan, 'GET', '/v1/me/settings')).json()).toMatchObject({
      acceptVoice: true,
      acceptCalls: false,
    });
    const hidden = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`)).json();
    expect(hidden.callsAvailable).toBe(false);
    expect((await call(noa)).statusCode).toBe(403);
    expect((await api(ctx, dan, 'PUT', '/v1/me/settings', {})).statusCode).toBe(400);
    await api(ctx, dan, 'PUT', '/v1/me/settings', { acceptCalls: true });

    const started = await call(noa);
    expect(started.statusCode).toBe(201);
    const id = started.json().id as string;
    // Strangers can't see, join or end it (no IDOR), and only one call per chat at a time.
    for (const url of [`/v1/calls/${id}`]) {
      expect((await api(ctx, eve, 'GET', url)).statusCode).toBe(404);
    }
    for (const action of ['join', 'decline', 'end']) {
      expect(
        (await api(ctx, eve, 'POST', `/v1/calls/${id}/${action}`, { publicKey: PK })).statusCode,
      ).toBe(404);
    }
    expect((await call(dan)).statusCode).toBe(409);
    // Dan is told (live and with a content-free push) and sees the call line in the chat.
    expect(ctx.jobs.push).toContainEqual({ userId: dan.id, kind: 'call', matchId });
    const line = (await api(ctx, dan, 'GET', `/v1/matches/${matchId}/messages`))
      .json()
      .messages.at(-1);
    expect(line).toMatchObject({
      kind: 'call',
      body: null,
      call: { id, status: 'ringing', mine: false },
    });
  });

  it('join tokens: one room, a role instead of an id, camera only on video calls, no screen share', async () => {
    await enable(30);
    await unlock();
    const voice = (await call(noa, false)).json();
    const verifier = new TokenVerifier(
      TEST_LIVEKIT.LIVEKIT_API_KEY,
      TEST_LIVEKIT.LIVEKIT_API_SECRET,
    );

    const caller = await api(ctx, noa, 'POST', `/v1/calls/${voice.id}/join`, { publicKey: PK });
    expect(caller.statusCode).toBe(200);
    expect(caller.json().url).toBe(TEST_LIVEKIT.LIVEKIT_URL);
    expect(caller.json().call.status).toBe('ringing'); // the caller waiting doesn't answer it
    const claims = await verifier.verify(caller.json().token);
    const row = await callRow(voice.id);
    expect(claims.sub).toBe('caller');
    // End-to-end encryption: the device's public key travels in the token, nothing else.
    expect(claims.attributes).toEqual({ pk: PK });
    expect(caller.json().room).toBe(row.room);
    expect(JSON.stringify(claims)).not.toContain(noa.id);
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: row.room,
      canPublishData: true,
      canPublishSources: ['microphone'],
    });
    expect(Number(claims.exp) - Number(claims.nbf ?? claims.iat)).toBeLessThanOrEqual(120);
    expect(rooms.created).toEqual([row.room]);
    expect(String(row.room)).toMatch(/^[0-9a-f]{32}$/);

    for (const publicKey of ['', 'not-a-key', 'x'.repeat(44), 'abc+/='.repeat(7) + 'a']) {
      const bad = await api(ctx, dan, 'POST', `/v1/calls/${voice.id}/join`, { publicKey });
      expect(bad.statusCode).toBe(400);
    }
    expect((await api(ctx, dan, 'POST', `/v1/calls/${voice.id}/join`)).statusCode).toBe(400);
    const callee = await api(ctx, dan, 'POST', `/v1/calls/${voice.id}/join`, { publicKey: PK });
    expect(callee.json().call).toMatchObject({ status: 'active' });
    expect(callee.json().call.endsAt).toBe(
      new Date(Date.parse(callee.json().call.answeredAt) + 30 * 60_000).toISOString(),
    );
    expect((await verifier.verify(callee.json().token)).sub).toBe('callee');
    await api(ctx, dan, 'POST', `/v1/calls/${voice.id}/end`);

    ctx.clock.value += 1000;
    const video = (await call(dan, true)).json();
    const token = (
      await api(ctx, noa, 'POST', `/v1/calls/${video.id}/join`, { publicKey: PK })
    ).json().token;
    expect((await verifier.verify(token)).video?.canPublishSources?.sort()).toEqual([
      'camera',
      'microphone',
    ]);
  });

  it('decline, hang up, missed calls and the time limit; ended calls can not be joined', async () => {
    await enable(30);
    await unlock();
    // Only the person called can decline.
    const first = (await call(noa)).json();
    expect((await api(ctx, noa, 'POST', `/v1/calls/${first.id}/decline`)).statusCode).toBe(403);
    const declined = await api(ctx, dan, 'POST', `/v1/calls/${first.id}/decline`);
    expect(declined.json()).toMatchObject({ status: 'declined' });
    expect(rooms.deleted).toContain((await callRow(first.id)).room);
    expect(
      (await api(ctx, dan, 'POST', `/v1/calls/${first.id}/join`, { publicKey: PK })).statusCode,
    ).toBe(409);

    // The caller hangs up before an answer: missed.
    await say(dan, 'Sorry, call me later');
    const second = (await call(noa)).json();
    expect((await api(ctx, noa, 'POST', `/v1/calls/${second.id}/end`)).json().status).toBe(
      'missed',
    );

    // Unanswered for 45 s: missed (worker), and can't be joined after the ring time.
    await say(dan, 'Now is fine');
    const third = (await call(noa)).json();
    ctx.clock.value += 46_000;
    expect(
      (await api(ctx, dan, 'POST', `/v1/calls/${third.id}/join`, { publicKey: PK })).statusCode,
    ).toBe(409);
    expect(await sweep()).toEqual({ missed: 1, ended: 0 });
    expect((await callRow(third.id)).status).toBe('missed');

    // Answered calls end at the community's limit (an hour later: 3 invitations per hour).
    await say(dan, 'Try again?');
    ctx.clock.value += 3_600_000;
    const fourth = (await call(noa)).json();
    await api(ctx, dan, 'POST', `/v1/calls/${fourth.id}/join`, { publicKey: PK });
    ctx.clock.value += 29 * 60_000;
    expect(await sweep()).toEqual({ missed: 0, ended: 0 });
    ctx.clock.value += 61_000;
    expect(await sweep()).toEqual({ missed: 0, ended: 1 });
    const ended = await api(ctx, noa, 'GET', `/v1/calls/${fourth.id}`);
    expect(ended.json()).toMatchObject({ status: 'ended', endsAt: null });
    expect(ended.json().durationSeconds).toBeGreaterThanOrEqual(30 * 60);
    expect(rooms.deleted).toContain((await callRow(fourth.id)).room);
    expect(await sweep()).toEqual({ missed: 0, ended: 0 }); // each call moves once
  });

  it('limits unwanted calls: per chat, a cooldown after refusals, one call at a time', async () => {
    await enable();
    await unlock();
    // Two refusals in a row: wait until they write.
    for (let i = 0; i < 2; i += 1) {
      const c = (await call(noa)).json();
      await api(ctx, dan, 'POST', `/v1/calls/${c.id}/decline`);
      ctx.clock.value += 1000;
    }
    const cooled = await call(noa);
    expect(cooled.statusCode).toBe(429);
    expect(cooled.json().error.message).toMatch(/Wait until they write/);
    await say(dan, 'Sorry, I was busy');
    ctx.clock.value += 1000;
    const third = await call(noa);
    expect(third.statusCode).toBe(201);
    await api(ctx, noa, 'POST', `/v1/calls/${third.json().id}/end`);
    // A fourth invitation in the same chat within an hour.
    await say(dan, 'Try now');
    ctx.clock.value += 1000;
    expect((await call(noa)).statusCode).toBe(429);

    // While in a call, you can't start another one in another chat.
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    await api(ctx, eve, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    const other = (
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: eve.id, kind: 'like' })
    ).json().matchId as string;
    const live = (await call(dan)).json();
    await api(ctx, noa, 'POST', `/v1/calls/${live.id}/join`, { publicKey: PK });
    for (let i = 0; i < 3; i += 1) {
      await api(ctx, dan, 'POST', `/v1/matches/${other}/messages`, {
        text: `Hey ${i}`,
        clientId: `eve-${i}-xxxxxx`,
      });
      await api(ctx, eve, 'POST', `/v1/matches/${other}/messages`, {
        text: `Hi ${i}`,
        clientId: `dan-${i}-xxxxxx`,
      });
    }
    const busy = await api(ctx, dan, 'POST', `/v1/matches/${other}/calls`, { video: true });
    expect(busy.statusCode).toBe(409);
  });

  it('block, unmatch, a report or a suspension hangs up at once', async () => {
    await enable();
    await unlock();
    const live = async () => {
      const c = (await call(noa)).json();
      await api(ctx, dan, 'POST', `/v1/calls/${c.id}/join`, { publicKey: PK });
      return c.id as string;
    };

    // A report (without blocking) ends the call.
    const reported = await live();
    const report = await api(ctx, noa, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'harassment',
      block: false,
    });
    expect(report.statusCode).toBe(201);
    expect((await callRow(reported)).status).toBe('ended');
    expect(rooms.deleted).toContain((await callRow(reported)).room);

    // Blocking ends the match and the call; the blocked person can't rejoin.
    await say(dan, 'Sorry about that');
    ctx.clock.value += 1000;
    const blocked = await live();
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
    await new Promise((r) => setTimeout(r, 50)); // listeners run after the response
    expect((await callRow(blocked)).status).toBe('ended');
    expect(
      (await api(ctx, dan, 'POST', `/v1/calls/${blocked}/join`, { publicKey: PK })).statusCode,
    ).toBe(404);

    // A moderator suspends someone mid-call (with Eve, a new match).
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    await api(ctx, eve, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    matchId = (
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: eve.id, kind: 'like' })
    ).json().matchId;
    for (let i = 0; i < 3; i += 1) {
      await say(dan, `Hey ${i}`);
      await say(eve, `Hi ${i}`);
    }
    const c = (await api(ctx, eve, 'POST', `/v1/matches/${matchId}/calls`, { video: true })).json();
    await api(ctx, dan, 'POST', `/v1/calls/${c.id}/join`, { publicKey: PK });
    const filed = await api(ctx, eve, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'harassment',
      block: false,
    });
    // (The report itself already hung up; start again to test the suspension on its own.)
    await say(dan, 'Please answer');
    ctx.clock.value += 1000;
    const again = (
      await api(ctx, eve, 'POST', `/v1/matches/${matchId}/calls`, { video: true })
    ).json();
    await api(ctx, dan, 'POST', `/v1/calls/${again.id}/join`, { publicKey: PK });
    const mod = await admin();
    const resolved = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${filed.json().reportId}/resolve`,
      headers: { cookie: mod },
      payload: {
        action: 'suspend',
        reason: 'Harassment on a call',
        explanation: 'Messages you sent broke the community guidelines.',
      },
    });
    expect(resolved.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect((await callRow(again.id)).status).toBe('ended');
  });

  it('webhooks: only signed events count; a person leaving ends the call', async () => {
    await enable();
    await unlock();
    const c = (await call(noa)).json();
    const { room } = await callRow(c.id);
    const post = (body: string, authorization?: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/livekit/webhook',
        headers: {
          'content-type': 'application/webhook+json',
          ...(authorization ? { authorization } : {}),
        },
        payload: body,
      });

    const joined = await signedWebhook('participant_joined', String(room), 'callee');
    expect((await post(joined.body)).statusCode).toBe(401);
    expect((await post(joined.body, 'not-a-token')).statusCode).toBe(401);
    // A valid signature over a different body (tampered) is refused.
    const tampered = joined.body.replace('participant_joined', 'room_finished');
    expect((await post(tampered, joined.authorization)).statusCode).toBe(401);
    expect((await callRow(c.id)).status).toBe('ringing');

    expect((await post(joined.body, joined.authorization)).statusCode).toBe(200);
    expect((await callRow(c.id)).status).toBe('active');
    const left = await signedWebhook('participant_left', String(room), 'caller');
    expect((await post(left.body, left.authorization)).statusCode).toBe(200);
    expect((await callRow(c.id)).status).toBe('ended');
    // Unknown rooms are accepted and ignored.
    const unknown = await signedWebhook('room_finished', 'f'.repeat(32));
    expect((await post(unknown.body, unknown.authorization)).statusCode).toBe(200);
  });

  it('report evidence, export and retention: a call is a line of text, never media', async () => {
    await enable();
    await unlock();
    const c = (await call(noa)).json();
    await api(ctx, dan, 'POST', `/v1/calls/${c.id}/join`, { publicKey: PK });
    ctx.clock.value += 14 * 60_000;
    await api(ctx, dan, 'POST', `/v1/calls/${c.id}/end`);
    const line = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`))
      .json()
      .messages.at(-1);
    expect(line.call).toMatchObject({ status: 'ended', durationSeconds: 14 * 60 });

    await api(ctx, noa, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'harassment',
      messageIds: [line.id],
    });
    const { rows } = await q('SELECT body, kind, media_key FROM report_evidence');
    expect(rows).toEqual([{ body: 'Video call: 14 min', kind: 'text', media_key: null }]);

    const zip = await api(ctx, dan, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.callsNoAudioOrVideoIsStored).toEqual([
      expect.objectContaining({ matchId, video: true, status: 'ended', startedByYou: false }),
    ]);
    expect(data.preferences.acceptCalls).toBe(true);

    // The report blocked Dan, which closed the chat; 30 days later the call log goes with it.
    await q(`UPDATE matches SET unmatched_at = now() - interval '31 days' WHERE id = $1`, [
      matchId,
    ]);
    await purgeClosedChats(ctx.services.dbHandle.db, ctx.services.storage);
    expect((await q('SELECT count(*)::int AS n FROM calls')).rows[0].n).toBe(0);
  });
});
