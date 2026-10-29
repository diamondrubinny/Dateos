// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('suggest another time (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let venueId: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const inHours = (h: number) => new Date(ctx.clock.value + h * 3_600_000).toISOString();
  const clientId = () => `counter-${(n += 1)}-xx`;
  /** Noa proposes; returns the plan id. */
  const propose = async () => {
    const res = await api(ctx, noa, 'POST', `/v1/matches/${matchId}/dates`, {
      venueId,
      startsAt: inHours(48),
      clientId: clientId(),
    });
    expect(res.statusCode).toBe(201);
    return res.json().date.id as string;
  };
  const counter = (m: Member, planId: string, over: Record<string, unknown> = {}) =>
    api(ctx, m, 'POST', `/v1/dates/${planId}/counter`, {
      startsAt: inHours(72),
      clientId: clientId(),
      ...over,
    });
  const cards = async (m: Member) =>
    (await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`))
      .json()
      .messages.filter((msg: { kind: string }) => msg.kind === 'date')
      .map((msg: { date: Record<string, unknown> }) => msg.date);

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;
    venueId = (
      await q(
        `INSERT INTO venues (name, area, category, address, step_free)
         VALUES ('Café Puaa', 'Jaffa', 'cafe', 'Rabbi Yohanan St 8', true) RETURNING id`,
      )
    ).rows[0].id;
  });

  it('declines the idea as countered and sends the same place at the new time', async () => {
    const planId = await propose();
    const res = await counter(dan, planId, { note: 'Saturday works better for me' });
    expect(res.statusCode).toBe(201);
    expect(res.json().date).toMatchObject({
      status: 'proposed',
      mine: true,
      countered: false,
      startsAt: inHours(72),
      note: 'Saturday works better for me',
      venue: { name: 'Café Puaa', area: 'Jaffa' },
    });
    // Noa sees her idea answered, and Dan's as the open one she can accept.
    const seen = await cards(noa);
    const old = seen.find((d: { id: string }) => d.id === planId);
    const fresh = seen.find((d: { id: string }) => d.id !== planId);
    expect(old).toMatchObject({ status: 'declined', countered: true, mine: true });
    expect(fresh).toMatchObject({ status: 'proposed', mine: false });
    expect((await api(ctx, noa, 'POST', `/v1/dates/${fresh.id}/accept`)).json().date.status).toBe(
      'accepted',
    );
  });

  it('only the person who received the idea, only while it is open', async () => {
    const planId = await propose();
    expect((await counter(noa, planId)).statusCode).toBe(403);
    const stranger = await createMember(ctx, {
      name: 'Lia',
      gender: 'woman',
      interestedIn: ['man'],
    });
    expect((await counter(stranger, planId)).statusCode).toBe(404);
    await api(ctx, dan, 'POST', `/v1/dates/${planId}/decline`);
    expect((await counter(dan, planId)).statusCode).toBe(409);
    // Nothing new was sent.
    expect(await cards(noa)).toHaveLength(1);
  });

  it('a different, valid time; the same retry is answered once', async () => {
    const planId = await propose();
    expect((await counter(dan, planId, { startsAt: inHours(48) })).statusCode).toBe(422);
    expect((await counter(dan, planId, { startsAt: inHours(0.1) })).statusCode).toBe(422);
    expect((await counter(dan, planId, { venueId })).statusCode).toBe(400);
    const id = clientId();
    const first = await counter(dan, planId, { clientId: id });
    const again = await counter(dan, planId, { clientId: id });
    expect(first.statusCode).toBe(201);
    expect(again.json().id).toBe(first.json().id);
    expect(await cards(dan)).toHaveLength(2);
  });

  it('a place the community took off its list can’t be suggested again', async () => {
    const planId = await propose();
    await q('UPDATE venues SET active = false WHERE id = $1', [venueId]);
    expect((await counter(dan, planId)).statusCode).toBe(404);
    // The idea itself is unchanged and can still be declined.
    expect((await cards(noa))[0]).toMatchObject({ status: 'proposed', countered: false });
  });

  it('a hurtful note is refused and changes nothing', async () => {
    const planId = await propose();
    const res = await counter(dan, planId, { note: 'you are an idiot' });
    expect(res.statusCode).toBe(422);
    expect((await cards(noa))[0]).toMatchObject({ status: 'proposed' });
  });
});
