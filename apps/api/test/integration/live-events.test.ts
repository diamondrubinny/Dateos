// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { TextModel } from '@nexaheart/ai';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { processEvents } from '../../../worker/src/event-jobs.js';
import type { Env } from '../../src/config/env.js';
import { checkInCode } from '../../src/modules/events/service.js';
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

const PK = 'q1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v';
const rooms = { created: [] as string[], deleted: [] as string[] };
const real = createLiveKitMedia(TEST_LIVEKIT as unknown as Env)!;
const media: CallMedia = {
  ...real,
  createRoom: async (room) => void rooms.created.push(room),
  deleteRoom: async (room) => void rooms.deleted.push(room),
};

/** A local model that records what it was sent. */
const seen: string[] = [];
const model: TextModel & { external: boolean } = {
  name: 'fake',
  external: false,
  async complete({ user }) {
    seen.push(user);
    return '{"distance":"near","enjoy":["cooking"],"gender":"man"}';
  },
};

describe.skipIf(!integrationEnabled)('AI matchmaker and live events (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let maya: Member;
  let dan: Member;
  let gil: Member;
  let admin: string;
  let venueId: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const at = (minutes: number) => new Date(ctx.clock.value + minutes * 60_000).toISOString();

  async function staff(role: 'moderator' | 'admin') {
    const email = `${role}-${(n += 1)}@example.test`;
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
    return cookie;
  }
  const asStaff = (cookie: string, method: 'GET' | 'POST', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const enableCalls = () =>
    q(`INSERT INTO instance_settings (id, calls_enabled) VALUES (1, true)
       ON CONFLICT (id) DO UPDATE SET calls_enabled = true`);
  async function publish(over: Record<string, unknown> = {}) {
    const res = await asStaff(admin, 'POST', '/v1/admin/events', {
      title: 'Evening meetup',
      venueId,
      startsAt: at(60),
      endsAt: at(180),
      ...over,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }
  const going = async (eventId: string, ...members: Member[]) => {
    for (const m of members) {
      expect((await api(ctx, m, 'POST', `/v1/events/${eventId}/rsvp`)).statusCode).toBe(200);
    }
  };

  beforeAll(async () => {
    ctx = await setupIntegration({ callMedia: media, textModel: model });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    ctx.clock.value = Date.now();
    rooms.created.length = 0;
    rooms.deleted.length = 0;
    seen.length = 0;
    model.external = false;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    maya = await createMember(ctx, { name: 'Maya', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    gil = await createMember(ctx, { name: 'Gil', gender: 'man', interestedIn: ['woman'] });
    admin = await staff('admin');
    venueId = (
      await asStaff(admin, 'POST', '/v1/admin/venues', {
        name: 'Cafe Nord',
        area: 'Tel Aviv',
        category: 'cafe',
        address: 'Dizengoff 1',
        stepFree: true,
      })
    ).json().id;
  });

  // ------------------------------------------------------------------ check-in and badge

  it('checks in with the rotating code at the venue, only during the event, with a "going" RSVP', async () => {
    const id = await publish();
    await going(id, noa);
    const mod = await staff('moderator');
    expect((await asStaff(mod, 'GET', `/v1/admin/events/${id}/check-in`)).statusCode).toBe(403);
    expect((await api(ctx, noa, 'GET', `/v1/admin/events/${id}/check-in`)).statusCode).toBe(403);
    const shown = (await asStaff(admin, 'GET', `/v1/admin/events/${id}/check-in`)).json();
    expect(shown.code).toMatch(/^\d{6}$/);
    expect(shown.url).toBe(`http://localhost:8081/events/${id}?code=${shown.code}`);
    // Too early: check-in opens 30 minutes before the start.
    const checkIn = (m: Member, code: string) =>
      api(ctx, m, 'POST', `/v1/events/${id}/check-in`, { code });
    expect((await checkIn(noa, shown.code)).statusCode).toBe(409);

    ctx.clock.value += 45 * 60_000;
    const now = (await asStaff(admin, 'GET', `/v1/admin/events/${id}/check-in`)).json();
    const wrong = now.code === '000000' ? '000001' : '000000';
    expect((await checkIn(noa, wrong)).statusCode).toBe(422);
    expect((await checkIn(noa, 'abc')).statusCode).toBe(400);
    // Dan isn't going: the event doesn't exist for this.
    expect((await checkIn(dan, now.code)).statusCode).toBe(404);
    // The code from the previous window still works (someone typing slowly)...
    ctx.clock.value += 30_000;
    const done = await checkIn(noa, now.code);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ checkedIn: true });
    expect((await checkIn(noa, now.code)).statusCode).toBe(200); // twice is harmless
    // ...but not an older one.
    await going(id, maya);
    ctx.clock.value += 60_000;
    expect((await checkIn(maya, now.code)).statusCode).toBe(422);
    const events = (await asStaff(admin, 'GET', '/v1/admin/events')).json().events;
    expect(events[0]).toMatchObject({ checkedInCount: 1 });

    // The badge is off by default; on, it says only "yes".
    const profile = async () => (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json();
    expect((await profile()).atEvent).toBe(false);
    expect((await api(ctx, noa, 'PUT', '/v1/me/event-badge', { on: true })).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().showEventBadge).toBe(true);
    expect((await profile()).atEvent).toBe(true);
    // A year later it's gone.
    await q(
      `UPDATE profiles SET event_check_in_at = now() - interval '13 months' WHERE user_id = $1`,
      [noa.id],
    );
    expect((await profile()).atEvent).toBe(false);

    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.eventsYouAreGoingTo[0].checkedInAt).toBeTruthy();
    expect(data.preferences.showCheckedInAtEventBadge).toBe(true);
  });

  it('the code depends on the event secret, which members never see', async () => {
    const id = await publish();
    await asStaff(admin, 'GET', `/v1/admin/events/${id}/check-in`);
    const { rows } = await q(`SELECT check_in_secret FROM events WHERE id = $1`, [id]);
    const secret = rows[0].check_in_secret as string;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    await going(id, noa);
    const body = (await api(ctx, noa, 'GET', `/v1/events/${id}`)).body;
    expect(body).not.toContain(secret);
    const step = Math.floor(ctx.clock.value / 30_000);
    const shown = (await asStaff(admin, 'GET', `/v1/admin/events/${id}/check-in`)).json();
    expect(shown.code).toBe(checkInCode(secret, step));
  });

  // ------------------------------------------------------------------ matchmaker

  it('suggests changes from taps and free text, applies only what was chosen, stores nothing', async () => {
    expect((await api(ctx, noa, 'GET', '/v1/me/matchmaker')).json()).toEqual({ text: 'available' });
    const res = await api(ctx, noa, 'POST', '/v1/me/matchmaker/suggest', {
      choices: { looking: 'short_term', ages: 'older', smoking: 'no_smokers' },
      text: 'Someone who loves cooking and lives close by',
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json();
    expect(result.usedText).toBe(true);
    const fields = result.suggestions.map((s: { change: { field: string } }) => s.change.field);
    // "gender" from the model is dropped; distance and interests come from the text.
    expect(fields.sort()).toEqual(
      ['ages', 'interests', 'intention', 'maxDistanceKm', 'smokingOk'].sort(),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('loves cooking');
    expect(seen[0]).not.toContain('Noa');

    const apply = await api(ctx, noa, 'POST', '/v1/me/matchmaker/apply', {
      changes: [
        { field: 'maxDistanceKm', value: 5 },
        { field: 'ages', value: { ageMin: 31, ageMax: 41 } },
        { field: 'interests', value: ['cooking'] },
        { field: 'smokingOk', value: ['no'] },
      ],
    });
    expect(apply.statusCode, apply.body).toBe(200);
    const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
    expect(me.preferences).toMatchObject({ maxDistanceKm: 5, ageMin: 31, ageMax: 41 });
    expect(me.about.interests).toEqual(['cooking']);
    expect(me.dealbreakers.smokingOk).toEqual(['no']);
    expect(me.profile.intention).toBe('long_term'); // not chosen, not changed

    // Sensitive fields can't be changed this way; bad values are refused.
    for (const bad of [
      { field: 'interestedIn', value: ['woman'] },
      { field: 'religionOk', value: ['religious'] },
      { field: 'ages', value: { ageMin: 40, ageMax: 30 } },
      { field: 'interests', value: ['skydiving'] },
    ]) {
      expect(
        (await api(ctx, noa, 'POST', '/v1/me/matchmaker/apply', { changes: [bad] })).statusCode,
      ).toBe(400);
    }
  });

  it('an external model needs the AI consent; the taps still work without it', async () => {
    model.external = true;
    expect((await api(ctx, noa, 'GET', '/v1/me/matchmaker')).json()).toEqual({
      text: 'needs_consent',
    });
    const res = (
      await api(ctx, noa, 'POST', '/v1/me/matchmaker/suggest', {
        choices: { distance: 'far' },
        text: 'Someone who loves cooking',
      })
    ).json();
    expect(res).toMatchObject({ usedText: false, textSkipped: 'needs_consent' });
    expect(res.suggestions).toEqual([
      { change: { field: 'maxDistanceKm', value: 150 }, current: 50 },
    ]);
    expect(seen).toHaveLength(0);
  });

  // ------------------------------------------------------------------ speed dating

  it('speed dating needs video calls and a small capacity', async () => {
    const speed = { kind: 'speed', capacity: 10, roundMinutes: 5 };
    const off = await asStaff(admin, 'POST', '/v1/admin/events', {
      title: 'Speed dating',
      venueId,
      startsAt: at(60),
      endsAt: at(120),
      ...speed,
    });
    expect(off.statusCode).toBe(409);
    await enableCalls();
    const big = await asStaff(admin, 'POST', '/v1/admin/events', {
      title: 'Speed dating',
      venueId,
      startsAt: at(60),
      endsAt: at(120),
      ...speed,
      capacity: 41,
    });
    expect(big.statusCode).toBe(400);
    const id = await publish(speed);
    expect((await api(ctx, noa, 'GET', `/v1/events/${id}`)).json()).toMatchObject({
      kind: 'speed',
      roundMinutes: 5,
    });
    // Only "going" members reach the lobby, and only around the event.
    expect((await api(ctx, noa, 'POST', `/v1/events/${id}/speed/lobby`)).statusCode).toBe(404);
    await going(id, noa);
    expect((await api(ctx, noa, 'POST', `/v1/events/${id}/speed/lobby`)).statusCode).toBe(409);
  });

  it('rounds pair people who may see each other; only a mutual yes makes a match', async () => {
    await enableCalls();
    const id = await publish({ kind: 'speed', capacity: 10, roundMinutes: 5, endsAt: at(120) });
    await going(id, noa, maya, dan, gil);
    ctx.clock.value += 60 * 60_000; // the event starts
    const enter = (m: Member) => api(ctx, m, 'POST', `/v1/events/${id}/speed/lobby`);
    expect((await enter(noa)).json()).toMatchObject({ inLobby: true, here: 1, current: null });
    await enter(maya);
    await enter(dan);
    // Dan arrived third: a round started with two of them, and Gil, arriving late, joins it.
    const last = (await enter(gil)).json();
    expect(last.here).toBe(4);
    expect(last.current).not.toBeNull();
    expect(rooms.created).toHaveLength(2);

    const state = async (m: Member) => (await api(ctx, m, 'GET', `/v1/events/${id}/speed`)).json();
    const noaDate = (await state(noa)).current;
    const mayaDate = (await state(maya)).current;
    // Women meet men here: every pair follows both people's "interested in".
    expect([dan.id, gil.id]).toContain(noaDate.with.id);
    expect([dan.id, gil.id]).toContain(mayaDate.with.id);
    expect(noaDate.with.id).not.toBe(mayaDate.with.id);
    const noaPartner = noaDate.with.id === dan.id ? dan : gil;
    const mayaPartner = noaPartner === dan ? gil : dan;

    // Joining: a LiveKit token for the two of them only.
    const join = await api(ctx, noa, 'POST', `/v1/speed-dates/${noaDate.id}/join`, {
      publicKey: PK,
    });
    expect(join.statusCode, join.body).toBe(200);
    expect(join.json().room).toBe(rooms.created.find((r) => r === join.json().room));
    expect(
      (await api(ctx, maya, 'POST', `/v1/speed-dates/${noaDate.id}/join`, { publicKey: PK }))
        .statusCode,
    ).toBe(404);

    // Answers are private; a mutual yes opens a match.
    const answer = (m: Member, dateId: string, yes: boolean) =>
      api(ctx, m, 'POST', `/v1/speed-dates/${dateId}/answer`, { yes });
    expect((await answer(noa, noaDate.id, true)).json()).toMatchObject({
      answer: true,
      matchId: null,
    });
    const both = (await answer(noaPartner, noaDate.id, true)).json();
    expect(both.matchId).toBeTruthy();
    const matches = (await api(ctx, noa, 'GET', '/v1/matches')).json().matches;
    expect(matches.map((m: { id: string }) => m.id)).toContain(both.matchId);

    await answer(maya, mayaDate.id, true);
    await answer(mayaPartner, mayaDate.id, false);
    const mine = (await state(maya)).current;
    expect(mine).toMatchObject({ answer: true, matchId: null });
    expect(JSON.stringify(mine)).not.toContain('false');

    // Leaving early ends the round for both.
    expect(
      (await api(ctx, maya, 'POST', `/v1/speed-dates/${mayaDate.id}/leave`)).json(),
    ).toMatchObject({ status: 'over' });
    expect((await state(mayaPartner)).current).toBeNull();

    // The next round, after the round and the break: nobody meets the same person twice.
    ctx.clock.value += 5 * 60_000 + 45_000;
    for (const m of [noa, maya, dan, gil]) await enter(m);
    const round2 = (await state(noa)).current;
    expect(round2).not.toBeNull();
    expect(round2.round).toBe(2);
    expect(round2.with.id).toBe(mayaPartner.id);
    const round2Room = (
      await api(ctx, noa, 'POST', `/v1/speed-dates/${round2.id}/join`, { publicKey: PK })
    ).json().room;
    // A block ends the live round at once.
    expect((await api(ctx, noa, 'POST', '/v1/blocks', { userId: mayaPartner.id })).statusCode).toBe(
      200,
    );
    await vi.waitFor(async () => expect((await state(noa)).current).toBeNull(), { timeout: 2000 });
    expect(rooms.deleted).toContain(round2Room);
    expect((await state(noa)).past).toHaveLength(2);

    // The export holds your own answers only; the worker clears it all with the RSVPs.
    const zip = await api(ctx, maya, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.speedDatingRounds[0]).toMatchObject({ round: 1, yourAnswer: true, matched: false });
    const later = new Date(ctx.clock.value + 40 * 86_400_000);
    const out = await processEvents({
      db: ctx.services.dbHandle.db,
      remind: async () => undefined,
      now: () => later,
    });
    expect(out.speedDatesDeleted).toBeGreaterThanOrEqual(3);
    const { rows } = await q(`SELECT count(*)::int AS n FROM speed_lobby`);
    expect(rows[0].n).toBe(0);
  });

  it('nobody is paired with someone outside their preferences', async () => {
    await enableCalls();
    const id = await publish({ kind: 'speed', capacity: 10, roundMinutes: 5 });
    // Dan only wants to meet people aged 40 and up: nobody here is.
    await api(ctx, dan, 'PUT', '/v1/me/preferences', {
      ageMin: 40,
      ageMax: 60,
      maxDistanceKm: 50,
      intentions: [],
    });
    await going(id, noa, dan);
    ctx.clock.value += 60 * 60_000;
    await api(ctx, noa, 'POST', `/v1/events/${id}/speed/lobby`);
    const s = (await api(ctx, dan, 'POST', `/v1/events/${id}/speed/lobby`)).json();
    expect(s).toMatchObject({ here: 2, current: null });
    expect(rooms.created).toHaveLength(0);
  });
});
