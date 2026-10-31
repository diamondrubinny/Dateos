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

describe.skipIf(!integrationEnabled)('event updates and questions (integration)', () => {
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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  const board = (m: Member, id: string) => api(ctx, m, 'GET', `/v1/events/${id}/board`);
  const ask = (m: Member, id: string, text: string) =>
    api(ctx, m, 'POST', `/v1/events/${id}/questions`, { body: text });

  it('shows updates only to people going or waiting, and tells them with a push', async () => {
    const id = await publish({ capacity: 2 });
    const lior = await createMember(ctx, { name: 'Lior', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    await api(ctx, lior, 'POST', `/v1/events/${id}/rsvp`);
    await api(ctx, dan, 'POST', `/v1/events/${id}/waitlist`);
    const maya = await createMember(ctx, { name: 'Maya', gender: 'woman', interestedIn: ['man'] });

    ctx.jobs.push.length = 0;
    const posted = await asStaff(admin, 'POST', `/v1/admin/events/${id}/updates`, {
      body: 'We moved inside: it might rain.',
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json().updates).toHaveLength(1);
    // Content-free pushes to everyone going or waiting, nobody else.
    expect(ctx.jobs.push.map((p) => [p.userId, p.kind, p.matchId]).sort()).toEqual(
      [
        [noa.id, 'event', id],
        [lior.id, 'event', id],
        [dan.id, 'event', id],
      ].sort(),
    );
    for (const m of [noa, dan]) {
      expect((await board(m, id)).json().updates).toEqual([
        {
          id: expect.any(String),
          body: 'We moved inside: it might rain.',
          createdAt: expect.any(String),
        },
      ]);
    }
    // Someone not going doesn't learn there are updates at all.
    expect((await board(maya, id)).statusCode).toBe(404);
    // No author, no attendee ids anywhere in what members get.
    expect(JSON.stringify((await board(noa, id)).json())).not.toMatch(/author|userId|user_id/);
  });

  it('only admins post and delete updates, until the event ends; all audited', async () => {
    const id = await publish();
    const mod = await staff('moderator');
    expect(
      (await asStaff(mod, 'POST', `/v1/admin/events/${id}/updates`, { body: 'hi' })).statusCode,
    ).toBe(403);
    expect(
      (await api(ctx, noa, 'POST', `/v1/admin/events/${id}/updates`, { body: 'hi' })).statusCode,
    ).toBe(403);
    // Moderators can read the board.
    expect((await asStaff(mod, 'GET', `/v1/admin/events/${id}/board`)).statusCode).toBe(200);
    const posted = (
      await asStaff(admin, 'POST', `/v1/admin/events/${id}/updates`, { body: 'Parking at gate 3.' })
    ).json();
    const updateId = posted.updates[0].id;
    expect(
      (await asStaff(admin, 'POST', `/v1/admin/events/${id}/updates`, { body: '' })).statusCode,
    ).toBe(400);
    expect(
      (await asStaff(admin, 'DELETE', `/v1/admin/events/${id}/updates/${updateId}`)).json().updates,
    ).toEqual([]);
    // Another event's update id is not found.
    const other = await publish({ title: 'Walking tour' });
    const otherUpdate = (
      await asStaff(admin, 'POST', `/v1/admin/events/${other}/updates`, { body: 'Meet at 6.' })
    ).json().updates[0].id;
    expect(
      (await asStaff(admin, 'DELETE', `/v1/admin/events/${id}/updates/${otherUpdate}`)).statusCode,
    ).toBe(404);
    // Cancelled or over: no more updates.
    await asStaff(admin, 'POST', `/v1/admin/events/${other}/cancel`);
    expect(
      (await asStaff(admin, 'POST', `/v1/admin/events/${other}/updates`, { body: 'x' })).statusCode,
    ).toBe(409);
    const { rows } = await q(
      `SELECT action, meta::text AS meta FROM audit_logs WHERE action LIKE 'event.update_%' ORDER BY created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'event.update_posted',
      'event.update_deleted',
      'event.update_posted',
    ]);
    // The text itself is never in the audit log.
    expect(rows.map((r) => r.meta).join()).not.toContain('Parking');
  });

  it('lets people going ask privately; staff answer without knowing who asked', async () => {
    const id = await publish();
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    await api(ctx, dan, 'POST', `/v1/events/${id}/rsvp`);
    const asked = await ask(noa, id, 'Is there parking nearby?');
    expect(asked.statusCode).toBe(200);
    await ask(dan, id, 'Can I bring a friend?');

    const staffBoard = (await asStaff(admin, 'GET', `/v1/admin/events/${id}/board`)).json();
    expect(staffBoard.questions.map((x: { body: string }) => x.body)).toEqual([
      'Is there parking nearby?',
      'Can I bring a friend?',
    ]);
    // Staff never get who asked.
    const raw = JSON.stringify(staffBoard);
    expect(raw).not.toContain(noa.id);
    expect(raw).not.toContain(dan.id);
    expect(raw).not.toMatch(/userId|user_id|email|name/);

    // Each member sees only their own questions.
    expect((await board(dan, id)).json().questions.map((x: { body: string }) => x.body)).toEqual([
      'Can I bring a friend?',
    ]);

    ctx.jobs.push.length = 0;
    const questionId = asked.json().id;
    const answered = await asStaff(
      admin,
      'POST',
      `/v1/admin/events/${id}/questions/${questionId}/answer`,
      { answer: 'Yes, at gate 3.' },
    );
    expect(answered.statusCode).toBe(200);
    expect(ctx.jobs.push).toEqual([{ userId: noa.id, kind: 'event', matchId: id }]);
    expect((await board(noa, id)).json().questions[0]).toMatchObject({
      body: 'Is there parking nearby?',
      answer: 'Yes, at gate 3.',
      answeredAt: expect.any(String),
    });
    expect((await board(dan, id)).json().questions[0].answer).toBeNull();
    const { rows } = await q(
      `SELECT meta::text AS meta FROM audit_logs WHERE action = 'event.question_answered'`,
    );
    expect(rows[0].meta).not.toContain('gate');
  });

  it('checks attendance, filters harm, limits open questions and lets the asker delete', async () => {
    const id = await publish();
    // Not going: not found.
    expect((await ask(noa, id, 'Hello?')).statusCode).toBe(404);
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    expect((await ask(noa, id, 'you are a stupid idiot')).statusCode).toBe(422);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await ask(noa, id, `Question ${i + 1}?`)).json().id);
    expect((await ask(noa, id, 'One more?')).statusCode).toBe(429);
    // Dan can't delete Noa's question.
    await api(ctx, dan, 'POST', `/v1/events/${id}/rsvp`);
    expect((await api(ctx, dan, 'DELETE', `/v1/events/${id}/questions/${ids[0]}`)).statusCode).toBe(
      404,
    );
    expect((await api(ctx, noa, 'DELETE', `/v1/events/${id}/questions/${ids[0]}`)).statusCode).toBe(
      200,
    );
    expect((await ask(noa, id, 'Now there is room?')).statusCode).toBe(200);
    // Leaving the event ends access to its board.
    await api(ctx, noa, 'DELETE', `/v1/events/${id}/rsvp`);
    expect((await board(noa, id)).statusCode).toBe(404);
  });

  it('deletes updates and questions with the RSVPs, and exports your own questions', async () => {
    const id = await publish();
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    await ask(noa, id, 'Is it step-free?');
    await asStaff(admin, 'POST', `/v1/admin/events/${id}/updates`, { body: 'See you there!' });

    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    const data = JSON.parse(strFromU8(zip['data.json']!));
    expect(data.questionsToEventOrganizers).toEqual([
      expect.objectContaining({
        event: 'Picnic in the park',
        question: 'Is it step-free?',
        answer: null,
      }),
    ]);

    // 31 days after the event ended, the retention job removes both.
    const ended = ctx.clock.value + 51 * 3_600_000 + 31 * 86_400_000;
    await processEvents({
      db: ctx.services.dbHandle.db,
      remind: async () => undefined,
      now: () => new Date(ended),
    });
    const left = await q(
      `SELECT (SELECT count(*)::int FROM event_updates) AS updates, (SELECT count(*)::int FROM event_questions) AS questions`,
    );
    expect(left.rows[0]).toEqual({ updates: 0, questions: 0 });
  });

  it('phase 71c: "I need help now" during the event, first for staff, a push to admins only', async () => {
    const id = await publish({ startsAt: inHours(1), endsAt: inHours(3) });
    await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
    const help = (m: Member, text: string) =>
      api(ctx, m, 'POST', `/v1/events/${id}/questions`, { body: text, urgent: true });
    // Not before it starts (check-in time, 30 minutes before).
    expect((await help(noa, 'Where is the entrance?')).statusCode).toBe(409);
    expect((await ask(noa, id, 'Is there parking?')).statusCode).toBe(200);
    ctx.clock.value += 40 * 60_000;
    // Only people going.
    expect((await help(dan, 'Help')).statusCode).toBe(404);
    ctx.jobs.push.length = 0;
    const sent = await help(noa, 'Someone keeps following me, I am near the bar');
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ urgent: true, answer: null });
    // Every admin gets a content-free push; nobody else does.
    const adminId = (await q(`SELECT id FROM "user" WHERE role = 'admin' LIMIT 1`)).rows[0]
      .id as string;
    expect(ctx.jobs.push).toEqual([{ userId: adminId, kind: 'event_help', matchId: id }]);

    // Staff see it first (asked later than the other question), highlighted, without who asked.
    const staffBoard = (await asStaff(admin, 'GET', `/v1/admin/events/${id}/board`)).json();
    expect(staffBoard.questions.map((x: { urgent: boolean }) => x.urgent)).toEqual([true, false]);
    expect(JSON.stringify(staffBoard)).not.toContain(noa.id);
    const answered = await asStaff(
      admin,
      'POST',
      `/v1/admin/events/${id}/questions/${staffBoard.questions[0].id}/answer`,
      { answer: 'A host is on the way to the bar now.' },
    );
    expect(answered.statusCode).toBe(200);
    const mine = (await board(noa, id)).json().questions;
    expect(mine.find((x: { urgent: boolean }) => x.urgent)).toMatchObject({
      answer: 'A host is on the way to the bar now.',
    });
    // Answered, it no longer jumps the queue.
    const after = (await asStaff(admin, 'GET', `/v1/admin/events/${id}/board`)).json();
    expect(after.questions.map((x: { urgent: boolean }) => x.urgent)).toEqual([false, true]);

    // At most 3 urgent messages per member per event; none after the end.
    expect((await help(noa, 'Still here')).statusCode).toBe(200);
    expect((await help(noa, 'Still here 2')).statusCode).toBe(200);
    expect((await help(noa, 'Still here 3')).statusCode).toBe(429);
    ctx.clock.value += 3 * 3_600_000;
    expect((await help(noa, 'After')).statusCode).toBe(409);
  });
});
