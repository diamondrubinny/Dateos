// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_PENDING_PROPOSALS } from '@nexaheart/shared';
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

describe.skipIf(!integrationEnabled)('community organizers, phase 71e (integration)', () => {
  let ctx: TestContext;
  let admin: string;
  let venueId: string;
  let noa: Member;
  let dan: Member;
  let n = 0;
  const HOUR = 3_600_000;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const at = (hours: number) => new Date(ctx.clock.value + hours * HOUR).toISOString();

  async function staff(role: 'admin' | 'moderator' = 'admin') {
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
  const as = (cookie: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const proposal = (over: Record<string, unknown> = {}) => ({
    title: 'Board games night',
    description: 'Bring your favourite game.',
    venueId,
    startsAt: at(72),
    endsAt: at(75),
    capacity: 20,
    ...over,
  });
  const emailOf = async (m: Member) =>
    (await q(`SELECT email FROM "user" WHERE id = $1`, [m.id])).rows[0].email as string;
  const propose = (m: Member, over: Record<string, unknown> = {}) =>
    api(ctx, m, 'POST', '/v1/organizer/proposals', proposal(over));

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    ctx.clock.value = Date.now();
    admin = await staff();
    venueId = (
      await as(admin, 'POST', '/v1/admin/venues', {
        name: 'Cafe Nord',
        area: 'Tel Aviv',
        category: 'cafe',
        address: 'Dizengoff 1',
      })
    ).json().id;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  it('admins appoint; organizers propose; admins approve or decline; members see who runs it', async () => {
    // Only organizers propose; only admins appoint.
    expect((await api(ctx, noa, 'GET', '/v1/organizer')).json()).toMatchObject({
      organizer: false,
      proposals: [],
    });
    expect((await propose(noa)).statusCode).toBe(403);
    const mod = await staff('moderator');
    expect(
      (await as(mod, 'POST', '/v1/admin/organizers', { email: await emailOf(noa) })).statusCode,
    ).toBe(403);
    expect(
      (await api(ctx, noa, 'POST', '/v1/admin/organizers', { email: await emailOf(noa) }))
        .statusCode,
    ).toBe(403);
    expect(
      (await as(admin, 'POST', '/v1/admin/organizers', { email: 'nobody@example.test' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await as(admin, 'POST', '/v1/admin/organizers', { email: await emailOf(noa) })).statusCode,
    ).toBe(200);
    expect((await as(admin, 'GET', '/v1/admin/organizers')).json().organizers).toEqual([
      expect.objectContaining({ userId: noa.id, displayName: 'Noa', events: 0 }),
    ]);

    // Validation: a community place, the future, a sensible length.
    expect((await propose(noa, { startsAt: at(-2), endsAt: at(-1) })).statusCode).toBe(422);
    expect((await propose(noa, { endsAt: at(100) })).statusCode).toBe(400);
    expect(
      (await propose(noa, { venueId: '6f1c2a59-1b8c-4d8e-9b8a-2d0b6a4f1c3e' })).statusCode,
    ).toBe(422);
    const sent = await propose(noa);
    expect(sent.statusCode, sent.body).toBe(200);
    const pending = sent.json().proposals[0];
    expect(pending).toMatchObject({ status: 'pending', title: 'Board games night', eventId: null });
    expect(pending.organizer).toBeUndefined();

    // The limit, and withdrawing.
    for (let i = 1; i < MAX_PENDING_PROPOSALS; i += 1) {
      expect((await propose(noa, { title: `Proposal ${i}` })).statusCode).toBe(200);
    }
    expect((await propose(noa, { title: 'One too many' })).statusCode).toBe(429);
    const extra = (await api(ctx, noa, 'GET', '/v1/organizer')).json().proposals[0].id;
    expect((await api(ctx, dan, 'DELETE', `/v1/organizer/proposals/${extra}`)).statusCode).toBe(
      404,
    );
    expect((await api(ctx, noa, 'DELETE', `/v1/organizer/proposals/${extra}`)).statusCode).toBe(
      200,
    );

    // Admins see the waiting proposals with who proposed them.
    const waiting = (await as(admin, 'GET', '/v1/admin/event-proposals')).json().proposals;
    expect(waiting).toHaveLength(MAX_PENDING_PROPOSALS - 1);
    expect(waiting[0].organizer).toEqual({ userId: noa.id, displayName: 'Noa' });

    // Decline with a reason the organizer sees.
    const toDecline = waiting.find((p: { title: string }) => p.title === 'Proposal 2').id;
    expect(
      (await as(admin, 'POST', `/v1/admin/event-proposals/${toDecline}/decline`, { reason: 'x' }))
        .statusCode,
    ).toBe(400);
    await as(admin, 'POST', `/v1/admin/event-proposals/${toDecline}/decline`, {
      reason: 'We already have an event that evening.',
    });
    const declined = (await api(ctx, noa, 'GET', '/v1/organizer'))
      .json()
      .proposals.find((p: { id: string }) => p.id === toDecline);
    expect(declined).toMatchObject({
      status: 'declined',
      reason: 'We already have an event that evening.',
    });

    // Approve: a published event with the organizer on it.
    const approved = await as(admin, 'POST', `/v1/admin/event-proposals/${pending.id}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    const eventId = approved.json().eventId as string;
    expect(
      (await as(admin, 'POST', `/v1/admin/event-proposals/${pending.id}/approve`)).statusCode,
    ).toBe(409);
    const seen = (await api(ctx, dan, 'GET', `/v1/events/${eventId}`)).json();
    expect(seen).toMatchObject({
      title: 'Board games night',
      capacity: 20,
      organizer: { displayName: 'Noa', events: 0 },
    });
    expect((await api(ctx, noa, 'GET', '/v1/organizer')).json().events).toEqual([
      expect.objectContaining({ id: eventId }),
    ]);

    // Running it: updates, answers (without who asked), the check-in code; only on her own event.
    await api(ctx, dan, 'POST', `/v1/events/${eventId}/rsvp`);
    await api(ctx, dan, 'POST', `/v1/events/${eventId}/questions`, { body: 'Is there parking?' });
    const board = (await api(ctx, noa, 'GET', `/v1/organizer/events/${eventId}/board`)).json();
    expect(board.questions).toHaveLength(1);
    expect(JSON.stringify(board)).not.toContain(dan.id);
    expect(
      (
        await api(ctx, noa, 'POST', `/v1/organizer/events/${eventId}/updates`, {
          body: 'Doors open at 19:30.',
        })
      ).statusCode,
    ).toBe(200);
    const answered = await api(
      ctx,
      noa,
      'POST',
      `/v1/organizer/events/${eventId}/questions/${board.questions[0].id}/answer`,
      { answer: 'Yes, across the street.' },
    );
    expect(answered.statusCode).toBe(200);
    expect((await api(ctx, dan, 'GET', `/v1/events/${eventId}/board`)).json()).toMatchObject({
      updates: [expect.objectContaining({ body: 'Doors open at 19:30.' })],
      questions: [expect.objectContaining({ answer: 'Yes, across the street.' })],
    });
    expect(
      (await api(ctx, noa, 'GET', `/v1/organizer/events/${eventId}/check-in`)).json().code,
    ).toMatch(/^\d{6}$/);
    // Not on someone else's event, and not for other members.
    const staffEvent = (
      await as(admin, 'POST', '/v1/admin/events', {
        title: 'Staff picnic',
        venueId,
        startsAt: at(80),
        endsAt: at(82),
      })
    ).json().id;
    expect(
      (await api(ctx, noa, 'GET', `/v1/organizer/events/${staffEvent}/board`)).statusCode,
    ).toBe(404);
    expect((await api(ctx, dan, 'GET', `/v1/organizer/events/${eventId}/board`)).statusCode).toBe(
      403,
    );
    expect((await api(ctx, noa, 'GET', '/v1/admin/events')).statusCode).toBe(403);

    // Once it took place, it counts.
    ctx.clock.value += 76 * HOUR;
    admin = await staff();
    expect((await api(ctx, dan, 'GET', `/v1/events/${eventId}`)).json().organizer).toEqual({
      displayName: 'Noa',
      events: 1,
    });

    // The export lists what she proposed.
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.eventsYouProposed.map((p: { status: string }) => p.status).sort()).toEqual(
      ['approved', 'declined', 'pending', 'pending'].sort(),
    );
  });

  it('taking the role back declines what waits and hands upcoming events to staff', async () => {
    await as(admin, 'POST', '/v1/admin/organizers', { email: await emailOf(noa) });
    await propose(noa);
    await propose(noa, { title: 'Second' });
    const [first] = (await as(admin, 'GET', '/v1/admin/event-proposals')).json().proposals;
    const eventId = (
      await as(admin, 'POST', `/v1/admin/event-proposals/${first.id}/approve`)
    ).json().eventId;
    expect((await as(admin, 'DELETE', `/v1/admin/organizers/${noa.id}`)).statusCode).toBe(200);
    expect((await as(admin, 'DELETE', `/v1/admin/organizers/${noa.id}`)).statusCode).toBe(404);
    const home = (await api(ctx, noa, 'GET', '/v1/organizer')).json();
    expect(home.organizer).toBe(false);
    expect(home.proposals.find((p: { title: string }) => p.title === 'Second')).toMatchObject({
      status: 'declined',
      reason: 'The organizer role ended.',
    });
    expect((await api(ctx, dan, 'GET', `/v1/events/${eventId}`)).json().organizer).toBeNull();
    expect((await api(ctx, noa, 'GET', `/v1/organizer/events/${eventId}/board`)).statusCode).toBe(
      403,
    );
    const { rows } = await q(
      `SELECT action FROM audit_logs WHERE action LIKE 'organizer.%' ORDER BY created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'organizer.granted',
      'organizer.proposal_approved',
      'organizer.revoked',
    ]);
  });
});
