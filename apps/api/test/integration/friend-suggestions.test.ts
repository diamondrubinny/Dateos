// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { FRIEND_SUGGESTIONS_DAILY } from '@nexaheart/shared';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)(
  'friends who suggest a pair, and profiles approved by hand, phase 68c (integration)',
  () => {
    let ctx: TestContext;
    let maya: Member; // the friend
    let noa: Member;
    let dan: Member;
    let eli: Member;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    beforeAll(async () => {
      ctx = await setupIntegration();
    });
    afterAll(async () => teardown(ctx));

    /** A friends-mode match, as if both had liked each other in friends mode. */
    const befriend = async (a: Member, b: Member) => {
      const [x, y] = [a.id, b.id].sort();
      await q(`INSERT INTO matches (user_a, user_b, mode) VALUES ($1, $2, 'friend')`, [x, y]);
    };

    beforeEach(async () => {
      await resetState(ctx);
      maya = await createMember(ctx, { name: 'Maya', gender: 'woman', interestedIn: ['man'] });
      noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
      await befriend(maya, noa);
      await befriend(maya, dan);
    });

    const suggest = (a: Member, b: Member, by: Member = maya) =>
      api(ctx, by, 'POST', '/v1/friend-suggestions', {
        aId: a.id,
        bId: b.id,
        note: 'You would love each other’s jokes',
      });
    const mine = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me/introductions')).json();

    it('a friend suggests two friends: private answers, a chat, labelled as a friend', async () => {
      const page = (await api(ctx, maya, 'GET', '/v1/friend-suggestions')).json();
      expect(page.friends.map((f: { id: string }) => f.id).sort()).toEqual([noa.id, dan.id].sort());
      expect(page.left).toBe(FRIEND_SUGGESTIONS_DAILY);
      const res = await suggest(noa, dan);
      expect(res.statusCode).toBe(200);
      const id = res.json().id as string;
      const forNoa = (await mine(noa)).received[0];
      expect(forNoa).toMatchObject({
        id,
        kind: 'friend',
        matchmaker: { displayName: 'Maya', since: null },
        other: { id: dan.id },
      });
      await api(ctx, noa, 'PUT', `/v1/introductions/${id}/answer`, { answer: 'yes' });
      const both = (
        await api(ctx, dan, 'PUT', `/v1/introductions/${id}/answer`, { answer: 'yes' })
      ).json();
      expect(both.state).toBe('matched');
      const sent = (await api(ctx, maya, 'GET', '/v1/friend-suggestions')).json().sent;
      expect(sent[0]).toMatchObject({ id, state: 'matched' });
      expect(JSON.stringify(sent)).not.toContain('yes');
      // Not a matchmaker: no console, never in the matchmakers' report.
      expect((await api(ctx, maya, 'GET', '/v1/introductions/console')).statusCode).toBe(403);
      const { rows } = await q(`SELECT kind FROM introductions WHERE id = $1`, [id]);
      expect(rows[0].kind).toBe('friend');
    });

    it('only between my friends, only to members who allow it, a few a day', async () => {
      const refused = async (a: Member, b: Member) =>
        expect((await suggest(a, b)).statusCode).toBe(409);
      await refused(noa, eli); // Eli isn't Maya's friend
      await befriend(maya, eli);
      await api(ctx, eli, 'PUT', '/v1/me/settings', { friendSuggestions: false });
      await refused(noa, eli); // Eli turned friend suggestions off
      expect((await api(ctx, eli, 'GET', '/v1/me/settings')).json().friendSuggestions).toBe(false);
      // A double-date pair counts as a friend too.
      const zoe = await createMember(ctx, { name: 'Zoe', gender: 'woman', interestedIn: ['man'] });
      const [a, b] = [maya.id, zoe.id].sort();
      await q(`INSERT INTO pairs (user_a, user_b) VALUES ($1, $2)`, [a, b]);
      expect((await suggest(zoe, dan)).statusCode).toBe(200);
      await q(
        `INSERT INTO introductions (matchmaker_id, kind, a_id, b_id, note, expires_at)
         SELECT $1, 'friend', $2, $3, 'x', now() FROM generate_series(1, $4)`,
        [maya.id, noa.id, eli.id, FRIEND_SUGGESTIONS_DAILY],
      );
      expect((await suggest(noa, dan)).statusCode).toBe(429);
    });

    // ------------------------------------------------------------ profiles approved by hand

    async function moderator(): Promise<Member> {
      const email = 'review-mod@example.test';
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
      return { cookie } as Member;
    }

    it('approval on: a new profile is hidden both ways until a moderator approves', async () => {
      const mod = await moderator();
      expect((await api(ctx, maya, 'GET', '/v1/me')).json().review).toEqual({
        status: 'approved',
        reason: null,
        note: null,
      });
      expect(
        (await api(ctx, mod, 'PATCH', '/v1/admin/instance', { profileApproval: true })).statusCode,
      ).toBe(200);
      const ron = await createMember(ctx, { name: 'Ron', gender: 'man', interestedIn: ['woman'] });
      expect((await api(ctx, ron, 'GET', '/v1/me')).json().review.status).toBe('pending');
      expect(await discoverIds(ctx, noa)).not.toContain(ron.id);
      expect(await discoverIds(ctx, ron)).toEqual([]);
      expect((await api(ctx, noa, 'GET', `/v1/profiles/${ron.id}`)).statusCode).toBe(404);
      // Existing profiles aren't affected.
      expect(await discoverIds(ctx, noa)).toContain(dan.id);
      // Members can't use the queue.
      expect((await api(ctx, noa, 'GET', '/v1/admin/profile-reviews')).statusCode).toBe(403);

      const queue = (await api(ctx, mod, 'GET', '/v1/admin/profile-reviews')).json().profiles;
      expect(queue).toEqual([
        expect.objectContaining({
          userId: ron.id,
          displayName: 'Ron',
          resubmitted: false,
          photoIds: [ron.photoId],
          prompts: [{ promptKey: 'green_flag', answer: 'Ron likes kindness' }],
        }),
      ]);
      expect(JSON.stringify(queue)).not.toMatch(/example\.test|lat/);
      const ask = await api(ctx, mod, 'POST', `/v1/admin/profile-reviews/${ron.id}`, {
        decision: 'changes',
        reason: 'photos',
        note: 'Please add a photo where your face shows',
      });
      expect(ask.statusCode).toBe(200);
      expect((await api(ctx, ron, 'GET', '/v1/me')).json().review).toEqual({
        status: 'changes',
        reason: 'photos',
        note: 'Please add a photo where your face shows',
      });
      expect((await api(ctx, mod, 'GET', '/v1/admin/profile-reviews')).json().profiles).toEqual([]);
      expect((await api(ctx, ron, 'POST', '/v1/me/review/resubmit')).statusCode).toBe(200);
      expect((await api(ctx, ron, 'POST', '/v1/me/review/resubmit')).statusCode).toBe(409);
      const again = (await api(ctx, mod, 'GET', '/v1/admin/profile-reviews')).json().profiles;
      expect(again[0]).toMatchObject({ userId: ron.id, resubmitted: true });
      expect(
        (
          await api(ctx, mod, 'POST', `/v1/admin/profile-reviews/${ron.id}`, {
            decision: 'approve',
          })
        ).statusCode,
      ).toBe(200);
      expect((await api(ctx, ron, 'GET', '/v1/me')).json().review.status).toBe('approved');
      expect(await discoverIds(ctx, noa)).toContain(ron.id);
      const { rows } = await q(
        `SELECT action FROM audit_logs WHERE target_id = $1 AND action LIKE 'profile.%' ORDER BY created_at`,
        [ron.id],
      );
      expect(rows.map((r) => r.action)).toEqual(['profile.changes_asked', 'profile.approved']);
      const zip = await api(ctx, ron, 'GET', '/v1/me/export');
      const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
      expect(data.profileReview).toMatchObject({ status: 'approved' });
    });
  },
);
