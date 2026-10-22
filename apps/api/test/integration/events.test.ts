// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processEvents } from '../../../worker/src/event-jobs.js';
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

describe.skipIf(!integrationEnabled)('community events (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let admin: string;
  let venueId: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const inHours = (h: number) => new Date(ctx.clock.value + h * 3_600_000).toISOString();

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
    const verify = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });
    expect(verify.statusCode).toBe(200);
    return cookie;
  }
  const asStaff = (
    cookie: string,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const event = (over: Record<string, unknown> = {}) => ({
    title: 'Picnic in the park',
    description: 'Bring a blanket.\nWe bring the snacks.',
    venueId,
    startsAt: inHours(48),
    endsAt: inHours(51),
    ...over,
  });
  async function publish(over: Record<string, unknown> = {}) {
    const res = await asStaff(admin, 'POST', '/v1/admin/events', event(over));
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    admin = await staff('admin');
    venueId = (
      await asStaff(admin, 'POST', '/v1/admin/venues', {
        name: 'HaYarkon Park',
        area: 'Tel Aviv',
        category: 'park',
        address: 'Rokach Blvd',
        stepFree: true,
      })
    ).json().id;
  });

  it('only admins publish, edit and cancel; moderators can see; every change is audited', async () => {
    const mod = await staff('moderator');
    expect((await asStaff(mod, 'POST', '/v1/admin/events', event())).statusCode).toBe(403);
    expect((await api(ctx, noa, 'POST', '/v1/admin/events', event())).statusCode).toBe(403);
    const id = await publish();
    expect(
      (await asStaff(mod, 'PATCH', `/v1/admin/events/${id}`, { capacity: 5 })).statusCode,
    ).toBe(403);
    expect(
      (await asStaff(admin, 'PATCH', `/v1/admin/events/${id}`, { capacity: 5 })).json(),
    ).toMatchObject({ capacity: 5, going: 0 });
    expect((await asStaff(mod, 'GET', '/v1/admin/events')).json().events).toHaveLength(1);
    expect((await asStaff(admin, 'POST', `/v1/admin/events/${id}/cancel`)).json().status).toBe(
      'cancelled',
    );
    const { rows } = await q(
      `SELECT action FROM audit_logs WHERE target_type = 'event' ORDER BY created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual(['event.create', 'event.update', 'event.cancel']);
  });

  it('validates events: future start, at most 24 hours, curated active place, capacity', async () => {
    // The shared schema refuses a bad window (400); the server checks the clock and the place (422).
    for (const bad of [
      { startsAt: inHours(10), endsAt: inHours(9) },
      { startsAt: inHours(10), endsAt: inHours(35) },
    ]) {
      expect((await asStaff(admin, 'POST', '/v1/admin/events', event(bad))).statusCode).toBe(400);
    }
    for (const bad of [
      { startsAt: inHours(-1), endsAt: inHours(1) },
      { venueId: crypto.randomUUID() },
    ]) {
      expect((await asStaff(admin, 'POST', '/v1/admin/events', event(bad))).statusCode).toBe(422);
    }
    expect(
      (await asStaff(admin, 'POST', '/v1/admin/events', event({ capacity: 1 }))).statusCode,
    ).toBe(400);
    expect(
      (await asStaff(admin, 'POST', '/v1/admin/events', event({ title: 'A\nB' }))).statusCode,
    ).toBe(400);
    await asStaff(admin, 'PATCH', `/v1/admin/venues/${venueId}`, { active: false });
    expect((await asStaff(admin, 'POST', '/v1/admin/events', event())).statusCode).toBe(422);
  });

  it('members see upcoming events with a count of people going, never who', async () => {
    const id = await publish();
    const past = await publish({ startsAt: inHours(1), endsAt: inHours(2) });
    expect((await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`)).json()).toMatchObject({
      going: 1,
      mine: true,
      venue: { name: 'HaYarkon Park', stepFree: true },
    });
    // Saying it twice is harmless.
    expect((await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`)).json().going).toBe(1);
    const seen = (await api(ctx, dan, 'GET', '/v1/events')).json().events;
    expect(seen.map((e: { id: string }) => e.id)).toEqual([past, id]);
    expect(seen[1]).toMatchObject({ going: 1, mine: false });
    // No attendee identity anywhere in what members or staff get.
    const all = JSON.stringify([
      seen,
      (await api(ctx, dan, 'GET', `/v1/events/${id}`)).json(),
      (await asStaff(admin, 'GET', '/v1/admin/events')).json(),
    ]);
    expect(all).not.toContain(noa.id);
    expect(all).not.toContain('Noa');

    ctx.clock.value += 3 * 3_600_000; // the first event has ended
    expect(
      (await api(ctx, dan, 'GET', '/v1/events')).json().events.map((e: { id: string }) => e.id),
    ).toEqual([id]);
    expect((await api(ctx, dan, 'POST', `/v1/events/${past}/rsvp`)).statusCode).toBe(409);
  });

  it('respects capacity, also when the last places are taken at the same time', async () => {
    const id = await publish({ capacity: 2 });
    const others = await Promise.all(
      ['Eve', 'Ann', 'Liv'].map((name) =>
        createMember(ctx, { name, gender: 'woman', interestedIn: ['man'] }),
      ),
    );
    const results = await Promise.all(
      [dan, ...others].map((m) => api(ctx, m, 'POST', `/v1/events/${id}/rsvp`)),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(2);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(2);
    const view = (await api(ctx, noa, 'GET', `/v1/events/${id}`)).json();
    expect(view).toMatchObject({ going: 2, full: true });
    // A place frees up when someone can't go after all.
    const goer = [dan, ...others][results.findIndex((r) => r.statusCode === 200)]!;
    expect((await api(ctx, goer, 'DELETE', `/v1/events/${id}/rsvp`)).json()).toMatchObject({
      going: 1,
      mine: false,
    });
    expect((await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`)).statusCode).toBe(200);
  });

  it('cancelling tells everyone going, blocks new answers and hides it from others', async () => {
    const id = await publish();
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    ctx.jobs.push.length = 0;
    await asStaff(admin, 'POST', `/v1/admin/events/${id}/cancel`);
    expect(ctx.jobs.push).toEqual([{ userId: noa.id, kind: 'event', matchId: id }]);
    expect((await api(ctx, dan, 'POST', `/v1/events/${id}/rsvp`)).statusCode).toBe(404);
    expect((await api(ctx, dan, 'GET', `/v1/events/${id}`)).statusCode).toBe(404);
    // Noa, who was going, still sees it as cancelled.
    expect((await api(ctx, noa, 'GET', '/v1/events')).json().events[0]).toMatchObject({
      id,
      status: 'cancelled',
      mine: true,
    });
    expect((await asStaff(admin, 'POST', `/v1/admin/events/${id}/cancel`)).statusCode).toBe(409);
  });

  it('suspended members cannot answer', async () => {
    const id = await publish();
    await q(`UPDATE "user" SET status = 'suspended' WHERE id = $1`, [dan.id]);
    expect((await api(ctx, dan, 'POST', `/v1/events/${id}/rsvp`)).statusCode).toBe(403);
  });

  it('reminds once the day before, then deletes who was going; export lists my events', async () => {
    const id = await publish({ startsAt: inHours(20), endsAt: inHours(22) });
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    const reminded: string[] = [];
    const run = (h: number) =>
      processEvents({
        db: ctx.services.dbHandle.db,
        remind: async (userId) => void reminded.push(userId),
        now: () => new Date(ctx.clock.value + h * 3_600_000),
      });
    expect((await run(0)).reminded).toBe(1);
    expect((await run(1)).reminded).toBe(0);
    expect(reminded).toEqual([noa.id]);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/export',
      headers: { cookie: noa.cookie },
    });
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(res.rawPayload))['data.json']!));
    expect(data.eventsYouAreGoingTo).toEqual([
      expect.objectContaining({ title: 'Picnic in the park', status: 'scheduled' }),
    ]);

    expect((await run(22 + 24 * 31)).rsvpsDeleted).toBe(1);
    expect((await q('SELECT count(*)::int AS n FROM events')).rows[0].n).toBe(1);
    expect((await run(22 + 24 * 366)).eventsDeleted).toBe(1);
  });

  // ------------------------------------------------------------------ waiting list (phase 16)

  it('waiting list: first come first served, a count only, places go to the next person', async () => {
    const id = await publish({ capacity: 2 });
    const [eve, ann, liv] = await Promise.all(
      ['Eve', 'Ann', 'Liv'].map((name) =>
        createMember(ctx, { name, gender: 'woman', interestedIn: ['man'] }),
      ),
    );
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    await api(ctx, dan, 'POST', `/v1/events/${id}/rsvp`);
    // Full: "I'm going" is refused, joining the waiting list works, in order.
    expect((await api(ctx, eve!, 'POST', `/v1/events/${id}/rsvp`)).statusCode).toBe(409);
    for (const [i, m] of [eve!, ann!, liv!].entries()) {
      ctx.clock.value += 1000;
      expect((await api(ctx, m, 'POST', `/v1/events/${id}/waitlist`)).json()).toMatchObject({
        going: 2,
        full: true,
        mine: false,
        waitingCount: i + 1,
        waitingAhead: i,
      });
    }
    // Joining twice keeps the place in the queue.
    expect((await api(ctx, eve!, 'POST', `/v1/events/${id}/waitlist`)).json().waitingAhead).toBe(0);
    expect((await api(ctx, noa, 'GET', `/v1/events/${id}`)).json()).toMatchObject({
      waitingCount: 3,
      waitingAhead: null,
    });
    // No identities, for members or staff.
    const all = JSON.stringify([
      (await api(ctx, liv!, 'GET', `/v1/events/${id}`)).json(),
      (await asStaff(admin, 'GET', '/v1/admin/events')).json(),
    ]);
    expect(all).not.toContain(eve!.id);
    expect(all).not.toContain('Eve');

    // Leaving the waiting list frees nothing; someone going leaving promotes the first in line.
    await api(ctx, ann!, 'DELETE', `/v1/events/${id}/rsvp`);
    ctx.jobs.push.length = 0;
    await api(ctx, dan, 'DELETE', `/v1/events/${id}/rsvp`);
    expect(ctx.jobs.push).toEqual([{ userId: eve!.id, kind: 'event', matchId: id }]);
    expect((await api(ctx, eve!, 'GET', `/v1/events/${id}`)).json()).toMatchObject({
      going: 2,
      mine: true,
      waitingAhead: null,
      waitingCount: 1,
    });
    expect((await api(ctx, liv!, 'GET', `/v1/events/${id}`)).json().waitingAhead).toBe(0);

    // More places from the admin go to the waiting list at once.
    ctx.jobs.push.length = 0;
    const raised = await asStaff(admin, 'PATCH', `/v1/admin/events/${id}`, { capacity: 5 });
    expect(raised.json()).toMatchObject({ going: 3, waitingCount: 0 });
    expect(ctx.jobs.push).toEqual([{ userId: liv!.id, kind: 'event', matchId: id }]);
    // A place that is free after all: the waiting list just means going.
    expect((await api(ctx, dan, 'POST', `/v1/events/${id}/waitlist`)).json()).toMatchObject({
      mine: true,
      waitingAhead: null,
    });
  });

  it('waiting list: no promotion once the event started; reminders only for people going; cancel tells everyone', async () => {
    const id = await publish({ capacity: 2, startsAt: inHours(20), endsAt: inHours(22) });
    // Published now: the admin's two-factor session doesn't last the 21 hours this test skips.
    const other = await publish({ capacity: 2, startsAt: inHours(48), endsAt: inHours(50) });
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    await api(ctx, dan, 'POST', `/v1/events/${id}/rsvp`);
    await api(ctx, eve, 'POST', `/v1/events/${id}/waitlist`);
    const reminded: string[] = [];
    await processEvents({
      db: ctx.services.dbHandle.db,
      remind: async (userId) => void reminded.push(userId),
      now: () => new Date(ctx.clock.value),
    });
    expect(reminded.sort()).toEqual([noa.id, dan.id].sort());

    // Once it started, a freed place stays free (nobody gets a surprise "you're going").
    ctx.clock.value += 21 * 3_600_000;
    await api(ctx, dan, 'DELETE', `/v1/events/${id}/rsvp`);
    expect((await api(ctx, eve, 'GET', `/v1/events/${id}`)).json()).toMatchObject({
      mine: false,
      waitingAhead: 0,
    });

    await api(ctx, noa, 'POST', `/v1/events/${other}/rsvp`);
    await api(ctx, dan, 'POST', `/v1/events/${other}/rsvp`);
    await api(ctx, eve, 'POST', `/v1/events/${other}/waitlist`);
    ctx.jobs.push.length = 0;
    const fresh = await staff('admin');
    await asStaff(fresh, 'POST', `/v1/admin/events/${other}/cancel`);
    expect(ctx.jobs.push.map((j) => j.userId).sort()).toEqual([noa.id, dan.id, eve.id].sort());
    // Eve still sees the cancelled event she was waiting for.
    expect((await api(ctx, eve, 'GET', `/v1/events/${other}`)).json().status).toBe('cancelled');
  });
});
