// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { UNANSWERED_LIMIT } from '@nexaheart/shared';
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
  'accountability and "My visibility", phase 70 (integration)',
  () => {
    let ctx: TestContext;
    let dan: Member;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    beforeAll(async () => {
      ctx = await setupIntegration();
    });
    afterAll(async () => teardown(ctx));
    beforeEach(async () => {
      await resetState(ctx);
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    });

    const visibility = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me/visibility')).json();
    let n = 0;
    const say = (m: Member, matchId: string, text: string) =>
      api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
        clientId: `msg-acc-${(n += 1)}-xxxx`,
        text,
      });

    /** A woman who matched with Dan and wrote to him `daysAgo` days ago, unanswered. */
    async function waitingFor(member: Member, daysAgo: number, name: string) {
      const w = await createMember(ctx, { name, gender: 'woman', interestedIn: ['man'] });
      await api(ctx, w, 'POST', '/v1/interactions', { targetId: member.id, kind: 'like' });
      const matchId = (
        await api(ctx, member, 'POST', '/v1/interactions', { targetId: w.id, kind: 'like' })
      ).json().matchId as string;
      await say(w, matchId, `Hi ${member.name}!`);
      await q(
        `UPDATE messages SET created_at = now() - make_interval(days => $2) WHERE match_id = $1`,
        [matchId, daysAgo],
      );
      return { w, matchId };
    }

    it('visible by default, and each limit is listed with why', async () => {
      expect(await visibility(dan)).toEqual({ visible: true, items: [] });
      await api(ctx, dan, 'PUT', '/v1/me/pause', { duration: '3d' });
      await api(ctx, dan, 'PUT', '/v1/me/settings', {
        verifiedContactOnly: true,
        dailyLikeLimit: 10,
      });
      await q(`UPDATE "user" SET incognito = true WHERE id = $1`, [dan.id]);
      await q(`UPDATE profiles SET review_status = 'pending' WHERE user_id = $1`, [dan.id]);
      // Ten likes in a day reach the limit.
      for (let i = 0; i < 10; i += 1) {
        const w = await createMember(ctx, {
          name: `W${i}`,
          gender: 'woman',
          interestedIn: ['man'],
        });
        await q(`INSERT INTO interactions (actor_id, target_id, kind) VALUES ($1, $2, 'like')`, [
          w.id,
          dan.id,
        ]);
      }
      const v = await visibility(dan);
      expect(v.visible).toBe(false);
      expect(v.items.map((i: { code: string }) => i.code)).toEqual([
        'on_break',
        'incognito',
        'pending_review',
        'like_limit',
        'verified_only',
      ]);
      expect(v.items[0]).toMatchObject({ hides: true, until: expect.any(String) });
      expect(v.items[3]).toMatchObject({ hides: true, count: 10 });
      expect(v.items[4]).toMatchObject({ hides: false });
      // No photo, no location.
      await q(`DELETE FROM photos WHERE user_id = $1`, [dan.id]);
      await q(`DELETE FROM locations WHERE user_id = $1`, [dan.id]);
      const codes = (await visibility(dan)).items.map((i: { code: string }) => i.code);
      expect(codes).toEqual(expect.arrayContaining(['no_photo', 'no_location']));
    });

    it(`${UNANSWERED_LIMIT}+ matches waiting 3+ days: listed, and new people see him less`, async () => {
      const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      const eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
      const waiting = [];
      for (let i = 0; i < UNANSWERED_LIMIT - 1; i += 1) {
        waiting.push(await waitingFor(dan, 4, `Wait${i}`));
      }
      // A fresh one (under 3 days) doesn't count yet.
      await waitingFor(dan, 1, 'Fresh');
      expect((await visibility(dan)).visible).toBe(true);
      const fifth = await waitingFor(dan, 5, 'Fifth');
      waiting.push(fifth);
      const v = await visibility(dan);
      expect(v.items).toEqual([{ code: 'unanswered', hides: false, count: UNANSWERED_LIMIT }]);
      // Still in Noa's Discover (never hidden), just after Eli, an otherwise identical profile.
      const ids = await discoverIds(ctx, noa);
      expect(ids).toContain(dan.id);
      expect(ids.indexOf(eli.id)).toBeLessThan(ids.indexOf(dan.id));
      // Replying to one lifts it at once.
      await say(dan, fifth.matchId, 'Sorry for the wait!');
      expect(await visibility(dan)).toEqual({ visible: true, items: [] });
    });

    it('only matches count: likes he never returned never do', async () => {
      for (let i = 0; i < UNANSWERED_LIMIT + 2; i += 1) {
        const w = await createMember(ctx, {
          name: `Fan${i}`,
          gender: 'woman',
          interestedIn: ['man'],
        });
        await api(ctx, w, 'POST', '/v1/interactions', {
          targetId: dan.id,
          kind: 'like',
          comment: 'Hi!',
        });
      }
      expect(await visibility(dan)).toEqual({ visible: true, items: [] });
    });

    it('closing kindly lifts it too', async () => {
      const all = [];
      for (let i = 0; i < UNANSWERED_LIMIT; i += 1) all.push(await waitingFor(dan, 4, `C${i}`));
      expect((await visibility(dan)).items[0].code).toBe('unanswered');
      const res = await api(ctx, dan, 'POST', `/v1/matches/${all[0]!.matchId}/close`, {
        message: 'Thank you, I don’t feel we’re a match. Good luck!',
      });
      expect(res.statusCode).toBe(200);
      expect((await visibility(dan)).visible).toBe(true);
    });
  },
);
