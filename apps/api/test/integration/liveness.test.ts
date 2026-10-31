// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { LivenessCallback } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signLiveness } from '../../src/modules/liveness/service.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  TEST_LIVENESS,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)(
  'live checks and asking to verify, phase 69 (integration)',
  () => {
    let ctx: TestContext;
    let noa: Member;
    let dan: Member;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    beforeAll(async () => {
      ctx = await setupIntegration({ liveness: true });
    });
    afterAll(async () => teardown(ctx));
    beforeEach(async () => {
      await resetState(ctx);
      noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    });

    const start = async (m: Member = noa) => {
      const res = await api(ctx, m, 'POST', '/v1/me/liveness');
      expect(res.statusCode).toBe(200);
      return new URL(res.json().url);
    };
    const send = (body: LivenessCallback, secret: string = TEST_LIVENESS.LIVENESS_SECRET) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/liveness/callback',
        headers: { 'x-nexaheart-signature': signLiveness(secret, body) },
        payload: body,
      });
    const result = (session: string, r: LivenessCallback['result'] = 'passed') => ({
      session,
      result: r,
      method: 'pretend',
      ts: Math.floor(ctx.clock.value / 1000),
    });
    const verified = async (m: Member = noa) =>
      (await api(ctx, m, 'GET', '/v1/me')).json().verified as boolean;

    it('the provider fetches the first photo once, and a pass gives the badge', async () => {
      expect((await api(ctx, noa, 'GET', '/v1/me/liveness')).json()).toEqual({
        available: true,
        last: null,
      });
      const url = await start();
      const session = url.searchParams.get('session')!;
      const photoUrl = new URL(url.searchParams.get('photo')!);
      expect(photoUrl.pathname).toBe(`/v1/liveness/sessions/${session}/photo`);
      const photo = await ctx.app.inject({ method: 'GET', url: photoUrl.pathname });
      expect(photo.statusCode).toBe(200);
      expect(photo.headers['cache-control']).toBe('no-store');
      // Once only.
      expect((await ctx.app.inject({ method: 'GET', url: photoUrl.pathname })).statusCode).toBe(
        404,
      );
      expect(await verified()).toBe(false);
      expect((await send(result(session))).statusCode).toBe(200);
      expect(await verified()).toBe(true);
      expect((await api(ctx, noa, 'GET', '/v1/me/liveness')).json().last).toMatchObject({
        result: 'passed',
        method: 'pretend',
      });
      // A replay is refused; only the result was stored.
      expect((await send(result(session))).statusCode).toBe(403);
      const { rows } = await q('SELECT * FROM liveness_checks');
      expect(Object.keys(rows[0]).sort()).toEqual(['checked_at', 'method', 'result', 'user_id']);
    });

    it('failed, no match, bad signatures, old results and changed photos give no badge', async () => {
      const s1 = (await start()).searchParams.get('session')!;
      await send(result(s1, 'no_match'));
      expect(await verified()).toBe(false);
      const s2 = (await start()).searchParams.get('session')!;
      expect((await send(result(s2), 'wrong-secret-0123456789abcdef0123')).statusCode).toBe(403);
      expect(
        (await send({ ...result(s2), ts: Math.floor(ctx.clock.value / 1000) - 3600 })).statusCode,
      ).toBe(403);
      // Photos changed during the check: the badge would vouch for other photos.
      await q(
        `UPDATE profiles SET photos_changed_at = now() + interval '1 minute' WHERE user_id = $1`,
        [noa.id],
      );
      expect((await send(result(s2))).statusCode).toBe(200);
      expect(await verified()).toBe(false);
      // Another member's session can't be used to fetch someone else's photo after the result.
      expect(
        (await ctx.app.inject({ method: 'GET', url: `/v1/liveness/sessions/${s2}/photo` }))
          .statusCode,
      ).toBe(404);
    });

    it('asking a match kindly to verify: once, a card for them, gone once verified', async () => {
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
      const matchId = (
        await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
      ).json().matchId as string;
      const page = async (m: Member) =>
        ((r) => (r.statusCode === 200 ? r.json().verifyRequest : r.body))(
          await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`),
        );
      expect(await page(noa)).toEqual({ asked: false, askedMe: false, canAsk: true });
      const ask = (m: Member) => api(ctx, m, 'POST', `/v1/matches/${matchId}/verify-request`);
      expect((await ask(noa)).statusCode).toBe(200);
      expect((await ask(noa)).statusCode).toBe(409); // once
      expect(await page(noa)).toEqual({ asked: true, askedMe: false, canAsk: false });
      expect(await page(dan)).toEqual({ asked: false, askedMe: true, canAsk: true });
      // Someone outside the chat can't.
      const eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
      expect((await ask(eli)).statusCode).toBe(404);
      // Dan verifies: the card goes, and Noa can't ask a verified person.
      await q(`UPDATE profiles SET verified_at = now() WHERE user_id = $1`, [dan.id]);
      expect((await page(dan)).askedMe).toBe(false);
      await q(`DELETE FROM verify_requests`);
      expect((await ask(noa)).statusCode).toBe(409);
    });
  },
);

describe.skipIf(!integrationEnabled)('live checks without a provider (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  it('not offered', async () => {
    await resetState(ctx);
    const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    expect((await api(ctx, noa, 'GET', '/v1/me/liveness')).json().available).toBe(false);
    expect((await api(ctx, noa, 'POST', '/v1/me/liveness')).statusCode).toBe(400);
  });
});
