// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processAvailability } from '../../../worker/src/availability-jobs.js';
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

describe.skipIf(!integrationEnabled)('after the match (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const inHours = (h: number) => new Date(ctx.clock.value + h * 3_600_000).toISOString();
  const day = (offset: number) =>
    new Date(ctx.clock.value + offset * 86_400_000).toISOString().slice(0, 10);

  async function venue() {
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
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/venues',
      headers: { cookie },
      payload: {
        name: 'Café Puaa',
        area: 'Jaffa',
        category: 'cafe',
        address: 'Rabbi Yohanan St 8, Tel Aviv-Yafo',
        note: null,
        stepFree: true,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function match(a: Member, b: Member) {
    await api(ctx, a, 'POST', '/v1/interactions', { targetId: b.id, kind: 'like' });
    return (await api(ctx, b, 'POST', '/v1/interactions', { targetId: a.id, kind: 'like' })).json()
      .matchId as string;
  }
  const say = (m: Member, id: string, text: string) =>
    api(ctx, m, 'POST', `/v1/matches/${id}/messages`, { text, clientId: `msg-${(n += 1)}-xxxx` });

  /** An accepted date at +48h, then the clock moved to `after` hours past its start. */
  async function acceptedDate(after: number) {
    const proposed = await api(ctx, noa, 'POST', `/v1/matches/${matchId}/dates`, {
      venueId: await venue(),
      startsAt: inHours(48),
      clientId: `date-${(n += 1)}-xx`,
    });
    expect(proposed.statusCode).toBe(201);
    const id = proposed.json().date.id as string;
    expect((await api(ctx, dan, 'POST', `/v1/dates/${id}/accept`)).statusCode).toBe(200);
    ctx.clock.value += (48 + after) * 3_600_000;
    return id;
  }
  const card = async (m: Member) =>
    (await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`)).json().messages.at(-1).date;

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    matchId = await match(dan, noa);
  });

  // ------------------------------------------------------------------ when we're both free

  it('shows only the overlap of free times, never the other full list', async () => {
    const url = `/v1/matches/${matchId}/availability`;
    expect((await api(ctx, noa, 'GET', url)).json()).toEqual({
      mine: [],
      theyShared: false,
      overlap: [],
    });
    const mine = [`${day(2)}:evening`, `${day(5)}:morning`, `${day(6)}:afternoon`];
    expect((await api(ctx, noa, 'PUT', url, { slots: mine })).statusCode).toBe(200);
    // Dan learns only that she shared something.
    expect((await api(ctx, dan, 'GET', url)).json()).toEqual({
      mine: [],
      theyShared: true,
      overlap: [],
    });
    const his = [`${day(5)}:morning`, `${day(2)}:evening`, `${day(3)}:evening`];
    const res = (await api(ctx, dan, 'PUT', url, { slots: his })).json();
    expect(res.overlap).toEqual([`${day(2)}:evening`, `${day(5)}:morning`]);
    expect(res.mine).not.toContain(`${day(6)}:afternoon`);
    expect(JSON.stringify(res)).not.toContain(`${day(6)}:afternoon`);
    const hers = (await api(ctx, noa, 'GET', url)).json();
    expect(hers.overlap).toEqual([`${day(2)}:evening`, `${day(5)}:morning`]);
    expect(JSON.stringify(hers)).not.toContain(`${day(3)}:evening`);
  });

  it('validates slots and only lets the two people in', async () => {
    const url = `/v1/matches/${matchId}/availability`;
    for (const slots of [
      [`${day(20)}:evening`],
      [`${day(-3)}:evening`],
      ['2026-02-31:evening'],
      [`${day(2)}:night`],
      [`${day(2)}:evening`, `${day(2)}:evening`],
      Array.from({ length: 22 }, (_, i) => `${day(i % 14)}:${['morning', 'evening'][i % 2]}`),
    ]) {
      expect((await api(ctx, noa, 'PUT', url, { slots })).statusCode).toBe(400);
    }
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await api(ctx, eve, 'GET', url)).statusCode).toBe(404);
    expect((await api(ctx, eve, 'PUT', url, { slots: [] })).statusCode).toBe(404);
  });

  it('deletes free times when the chat closes and after two weeks', async () => {
    const url = `/v1/matches/${matchId}/availability`;
    await api(ctx, noa, 'PUT', url, { slots: [`${day(1)}:evening`] });
    const other = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    const second = await match(other, dan);
    await api(ctx, dan, 'PUT', `/v1/matches/${second}/availability`, {
      slots: [`${day(1)}:morning`],
    });
    await api(ctx, dan, 'DELETE', `/v1/matches/${matchId}`);
    await processAvailability(ctx.services.dbHandle.db, new Date(ctx.clock.value));
    expect((await q(`SELECT match_id FROM match_availability`)).rows).toEqual([
      { match_id: second },
    ]);
    await processAvailability(
      ctx.services.dbHandle.db,
      new Date(ctx.clock.value + 15 * 86_400_000),
    );
    expect((await q(`SELECT 1 FROM match_availability`)).rows).toHaveLength(0);
  });

  // ------------------------------------------------------------------ did you meet?

  it('asks "did you meet?" only two hours after an accepted date', async () => {
    const id = await acceptedDate(1);
    expect((await card(noa)).feedback).toEqual({ canGive: false, mine: null, bothAgain: false });
    const early = await api(ctx, noa, 'POST', `/v1/dates/${id}/feedback`, {
      met: true,
      again: 'yes',
    });
    expect(early.statusCode).toBe(409);
    ctx.clock.value += 3_600_000;
    expect((await card(noa)).feedback.canGive).toBe(true);
    // "Again" only after meeting; outsiders get 404.
    expect(
      (await api(ctx, noa, 'POST', `/v1/dates/${id}/feedback`, { met: false, again: 'yes' }))
        .statusCode,
    ).toBe(400);
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect(
      (await api(ctx, eve, 'POST', `/v1/dates/${id}/feedback`, { met: true, again: null }))
        .statusCode,
    ).toBe(404);
  });

  it('keeps answers private and reveals only a mutual "again"', async () => {
    const id = await acceptedDate(3);
    const mine = await api(ctx, noa, 'POST', `/v1/dates/${id}/feedback`, {
      met: true,
      again: 'yes',
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().date.feedback).toEqual({
      canGive: true,
      mine: { met: true, again: 'yes' },
      bothAgain: false,
    });
    // Dan sees nothing of her answer.
    expect((await card(dan)).feedback).toEqual({ canGive: true, mine: null, bothAgain: false });

    await api(ctx, dan, 'POST', `/v1/dates/${id}/feedback`, { met: true, again: 'unsure' });
    expect((await card(noa)).feedback.bothAgain).toBe(false);
    expect((await card(dan)).feedback).toEqual({
      canGive: true,
      mine: { met: true, again: 'unsure' },
      bothAgain: false,
    });
    await api(ctx, dan, 'POST', `/v1/dates/${id}/feedback`, { met: true, again: 'yes' });
    expect((await card(noa)).feedback.bothAgain).toBe(true);
    expect((await card(dan)).feedback.bothAgain).toBe(true);

    // Each person's export holds only their own answers.
    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    const data = JSON.parse(strFromU8(zip['data.json']!));
    expect(data.dateIdeas[0]).toMatchObject({ youSaidYouMet: true, youWouldMeetAgain: 'yes' });
    expect(JSON.stringify(data.dateIdeas)).not.toContain('unsure');
  });

  it('shows the met-in-person badge only when turned on and both confirmed', async () => {
    const id = await acceptedDate(3);
    await api(ctx, noa, 'POST', `/v1/dates/${id}/feedback`, { met: true, again: null });
    expect((await api(ctx, noa, 'PUT', '/v1/me/met-badge', { on: true })).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().showMetBadge).toBe(true);
    const view = async () => (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json();
    // Only Noa said they met: no badge yet.
    expect((await view()).metInPerson).toBe(false);
    await api(ctx, dan, 'POST', `/v1/dates/${id}/feedback`, { met: true, again: null });
    expect((await view()).metInPerson).toBe(true);
    await api(ctx, noa, 'PUT', '/v1/me/met-badge', { on: false });
    expect((await view()).metInPerson).toBe(false);
  });

  // ------------------------------------------------------------------ focus mode

  it('asks for replies before new likes when six people are waiting', async () => {
    for (let i = 0; i < 6; i += 1) {
      const m = await createMember(ctx, {
        name: `Man${i}`,
        gender: 'man',
        interestedIn: ['woman'],
      });
      const id = await match(m, noa);
      expect((await say(m, id, `Hi Noa, I'm ${i}`)).statusCode).toBe(200);
    }
    expect((await api(ctx, noa, 'GET', '/v1/me/your-turn')).json()).toEqual({
      waiting: 6,
      limit: 6,
    });
    const next = await createMember(ctx, { name: 'Gil', gender: 'man', interestedIn: ['woman'] });
    const like = await api(ctx, noa, 'POST', '/v1/interactions', {
      targetId: next.id,
      kind: 'like',
    });
    expect(like.statusCode).toBe(409);
    expect(like.json().error.code).toBe('YOUR_TURN');
    // Passing is still allowed.
    const other = await createMember(ctx, { name: 'Ido', gender: 'man', interestedIn: ['woman'] });
    expect(
      (await api(ctx, noa, 'POST', '/v1/interactions', { targetId: other.id, kind: 'pass' }))
        .statusCode,
    ).toBeLessThan(300);
    // Answering one person lifts the pause.
    const { rows } = await q(
      `SELECT m.id FROM matches m JOIN messages x ON x.match_id = m.id
       WHERE (m.user_a = $1 OR m.user_b = $1) LIMIT 1`,
      [noa.id],
    );
    expect((await say(noa, rows[0].id, 'Hi!')).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me/your-turn')).json().waiting).toBe(5);
    expect(
      (await api(ctx, noa, 'POST', '/v1/interactions', { targetId: next.id, kind: 'like' }))
        .statusCode,
    ).toBeLessThan(300);
  });
});
