// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)(
  'protection on the receiving side, phase 65 (integration)',
  () => {
    let ctx: TestContext;
    let noa: Member;
    let dan: Member;
    let eli: Member;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    beforeAll(async () => {
      ctx = await setupIntegration();
    });
    afterAll(async () => teardown(ctx));
    beforeEach(async () => {
      await resetState(ctx);
      noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
    });

    const settings = (m: Member, body: Record<string, unknown>) =>
      api(ctx, m, 'PUT', '/v1/me/settings', body);
    /** Likes from accounts that exist only for the count. */
    async function likesFrom(n: number, target: string, hoursAgo = 0) {
      for (let i = 0; i < n; i += 1) {
        const id = `liker-${target.slice(0, 6)}-${hoursAgo}-${i}`;
        await q(`INSERT INTO "user" (id, email) VALUES ($1, $2)`, [id, `${id}@example.test`]);
        await q(
          `INSERT INTO interactions (actor_id, target_id, kind, created_at)
         VALUES ($1, $2, 'like', now() - make_interval(hours => $3))`,
          [id, target, hoursAgo],
        );
      }
    }
    async function match(a: Member, b: Member): Promise<string> {
      await api(ctx, a, 'POST', '/v1/interactions', { targetId: b.id, kind: 'like' });
      return (
        await api(ctx, b, 'POST', '/v1/interactions', { targetId: a.id, kind: 'like' })
      ).json().matchId;
    }
    const write = (m: Member, matchId: string, text: string) =>
      api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
        text,
        clientId: `c-${Math.random().toString(36).slice(2, 12)}`,
      });

    it('the settings: off by default, saved, only the offered limits', async () => {
      const before = (await api(ctx, noa, 'GET', '/v1/me/settings')).json();
      expect(before).toMatchObject({ dailyLikeLimit: null, verifiedContactOnly: false });
      expect(
        (await settings(noa, { dailyLikeLimit: 25, verifiedContactOnly: true })).statusCode,
      ).toBe(200);
      expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json()).toMatchObject({
        dailyLikeLimit: 25,
        verifiedContactOnly: true,
      });
      for (const bad of [0, 7, 1000, '10']) {
        expect((await settings(noa, { dailyLikeLimit: bad })).statusCode).toBe(400);
      }
      expect((await settings(noa, { dailyLikeLimit: null })).statusCode).toBe(200);
      const zip = await api(ctx, noa, 'GET', '/v1/me/export');
      const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
      expect(data.preferences).toMatchObject({ dailyLikeLimit: null, verifiedContactOnly: true });
    });

    it('new likes a day: once reached, new people stop seeing the member for 24 hours', async () => {
      expect(await discoverIds(ctx, dan)).toContain(noa.id);
      await settings(noa, { dailyLikeLimit: 10 });
      await likesFrom(9, noa.id);
      expect(await discoverIds(ctx, dan)).toContain(noa.id); // 9 of 10
      // Eli likes her: the tenth.
      await api(ctx, eli, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
      expect(await discoverIds(ctx, dan)).not.toContain(noa.id);
      // Likes older than 24 hours don't count.
      await q(
        `UPDATE interactions SET created_at = now() - interval '25 hours' WHERE target_id = $1 AND actor_id LIKE 'liker-%'`,
        [noa.id],
      );
      expect(await discoverIds(ctx, dan)).toContain(noa.id);
      // Turning it off shows her again at once, however many likes.
      await likesFrom(20, noa.id, 1);
      expect(await discoverIds(ctx, dan)).not.toContain(noa.id);
      await settings(noa, { dailyLikeLimit: null });
      expect(await discoverIds(ctx, dan)).toContain(noa.id);
    });

    it('new likes a day: someone the member liked still sees her', async () => {
      await settings(noa, { dailyLikeLimit: 10 });
      await likesFrom(10, noa.id);
      expect(await discoverIds(ctx, dan)).not.toContain(noa.id);
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
      expect(await discoverIds(ctx, dan)).toContain(noa.id);
    });

    it('only verified can reach me: hidden from unverified people in Discover', async () => {
      await settings(noa, { verifiedContactOnly: true });
      expect(await discoverIds(ctx, dan)).not.toContain(noa.id);
      await q(`UPDATE profiles SET verified_at = now() WHERE user_id = $1`, [dan.id]);
      expect(await discoverIds(ctx, dan)).toContain(noa.id);
      // Someone she liked sees her, verified or not.
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: eli.id, kind: 'like' });
      expect(await discoverIds(ctx, eli)).toContain(noa.id);
    });

    it('only verified can write to me, unless I wrote first; the chat says so', async () => {
      const matchId = await match(dan, noa);
      await settings(noa, { verifiedContactOnly: true });
      const page = (await api(ctx, dan, 'GET', `/v1/matches/${matchId}/messages`)).json();
      expect(page.writeNeedsVerification).toBe(true);
      const refused = await write(dan, matchId, 'Hi Noa!');
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error.code).toBe('VERIFIED_ONLY');
      // Noa sees nothing of it, and her own view isn't limited.
      const hers = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`)).json();
      expect(hers.messages).toHaveLength(0);
      expect(hers.writeNeedsVerification).toBe(false);
      // Once she writes, he can answer.
      expect((await write(noa, matchId, 'Hi Dan, how was your day?')).statusCode).toBe(200);
      expect((await write(dan, matchId, 'Great, thanks!')).statusCode).toBe(200);
      expect(
        (await api(ctx, dan, 'GET', `/v1/matches/${matchId}/messages`)).json()
          .writeNeedsVerification,
      ).toBe(false);

      // A verified member writes first without waiting.
      await q(`UPDATE profiles SET verified_at = now() WHERE user_id = $1`, [eli.id]);
      const other = await match(eli, noa);
      expect((await write(eli, other, 'Hello!')).statusCode).toBe(200);
    });

    it('an extortion message: the receiver sees the signal, the sender doesn’t', async () => {
      const matchId = await match(dan, noa);
      for (let i = 0; i < 12; i += 1) await write(i % 2 ? dan : noa, matchId, `message ${i}`);
      const res = await write(dan, matchId, 'Pay me 500 or I will send the video to your family');
      expect(res.statusCode).toBe(200);
      expect(res.json().scam).toEqual([]);
      const hers = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`)).json();
      expect(hers.messages.at(-1).scam).toContain('extortion');
    });
  },
);
