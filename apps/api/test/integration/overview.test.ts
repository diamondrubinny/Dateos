// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { NEW_ACCOUNT_CHAT_STARTS } from '@nexaheart/shared';
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

describe.skipIf(!integrationEnabled)('safety overview and a gentle start (integration)', () => {
  let ctx: TestContext;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  async function staff(role: 'moderator' | 'admin') {
    const email = `${role}-overview-${(n += 1)}@example.test`;
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
  const overview = (cookie: string) =>
    ctx.app.inject({ method: 'GET', url: '/v1/admin/overview', headers: { cookie } });

  // ------------------------------------------------------------------ overview

  describe('overview', () => {
    it('counts the queue and the last 7 days, without names or ids', async () => {
      const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      const eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
      const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      const report = (
        reported: string,
        category: string,
        priority: string,
        extra: {
          automatic?: boolean;
          hoursAgo?: number;
          resolvedAfter?: number;
          reporter?: string;
        } = {},
      ) =>
        q(
          `INSERT INTO reports (reporter_id, reported_id, category, priority, automatic, created_at,
             status, resolved_at)
           VALUES ($1, $2, $3, $4, $5, now() - make_interval(hours => $6),
             CASE WHEN $7::int IS NULL THEN 'open' ELSE 'dismissed' END::report_status,
             now() - make_interval(hours => $6) + make_interval(hours => $7::int))`,
          [
            extra.automatic ? null : (extra.reporter ?? noa.id),
            reported,
            category,
            priority,
            extra.automatic ?? false,
            extra.hoursAgo ?? 1,
            extra.resolvedAfter ?? null,
          ],
        );
      await report(dan.id, 'harassment', 'high', { hoursAgo: 30 });
      await report(dan.id, 'scam', 'normal', { reporter: eli.id });
      await report(eli.id, 'spam', 'normal', { automatic: true });
      await report(eli.id, 'other', 'normal', { hoursAgo: 10, resolvedAfter: 2 });
      await report(eli.id, 'other', 'normal', { hoursAgo: 10, resolvedAfter: 4, reporter: dan.id });
      // An old one, outside the 7 days.
      await report(dan.id, 'other', 'normal', { hoursAgo: 24 * 9, resolvedAfter: 1 });
      await q(
        `INSERT INTO audit_logs (action, target_type, target_id, meta)
         VALUES ('report.automatic', 'user', $1, '{"reason":"same_message"}'),
                ('moderation.suspend', 'user', $1, NULL)`,
        [eli.id],
      );
      await q(`UPDATE "user" SET created_at = now() - interval '30 days' WHERE id = $1`, [noa.id]);

      const res = await overview(await staff('moderator'));
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.open).toEqual({
        total: 3,
        byPriority: { urgent: 0, high: 1, normal: 2 },
        byCategory: { harassment: 1, scam: 1, spam: 1 },
        oldestHours: 30,
      });
      expect(body.recent).toMatchObject({
        days: 7,
        fromMembers: 4,
        automatic: 1,
        automaticByReason: { same_message: 1 },
        resolved: 2,
        medianResolveHours: 3,
        suspensions: 1,
      });
      // Dan, Eli and the staff member are new; Noa's account is 30 days old.
      expect(body.recent.newAccounts).toBe(3);
      expect(body.verificationsWaiting).toBe(0);
      const text = JSON.stringify(body);
      for (const id of [dan.id, eli.id, noa.id]) expect(text).not.toContain(id);
    });

    it('an empty queue has no oldest age and no median', async () => {
      const body = (await overview(await staff('admin'))).json();
      expect(body.open.total).toBe(0);
      expect(body.open.oldestHours).toBeNull();
      expect(body.recent.medianResolveHours).toBeNull();
    });

    it('members and signed-out visitors get nothing', async () => {
      const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      expect((await api(ctx, noa, 'GET', '/v1/admin/overview')).statusCode).toBe(403);
      expect((await ctx.app.inject({ method: 'GET', url: '/v1/admin/overview' })).statusCode).toBe(
        401,
      );
    });
  });

  // ------------------------------------------------------------------ a gentle start

  describe('a gentle start for new accounts', () => {
    /** A member matched with `count` people (written directly: liking that many hits the daily limit). */
    async function matched(count: number) {
      const me = await createMember(ctx, { name: 'New', gender: 'man', interestedIn: ['woman'] });
      const others: { member: Member; matchId: string }[] = [];
      for (let i = 0; i < count; i += 1) {
        const her = await createMember(ctx, {
          name: `Her${i}`,
          gender: 'woman',
          interestedIn: ['man'],
        });
        const [a, b] = [me.id, her.id].sort();
        const { rows } = await q(
          `INSERT INTO matches (user_a, user_b) VALUES ($1, $2) RETURNING id`,
          [a, b],
        );
        others.push({ member: her, matchId: rows[0].id });
      }
      return { me, others };
    }
    let c = 0;
    const say = (m: Member, matchId: string, text = 'Hi there') =>
      api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
        text,
        clientId: `gentle-${(c += 1)}`,
      });

    it(`a day-old account can start ${NEW_ACCOUNT_CHAT_STARTS} chats; replies are never limited`, async () => {
      const { me, others } = await matched(NEW_ACCOUNT_CHAT_STARTS + 2);
      for (const o of others.slice(0, NEW_ACCOUNT_CHAT_STARTS)) {
        expect((await say(me, o.matchId)).statusCode).toBe(200);
      }
      const blocked = await say(me, others[NEW_ACCOUNT_CHAT_STARTS]!.matchId);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('SLOW_DOWN');
      // More messages in chats already started are fine.
      expect((await say(me, others[0]!.matchId, 'How was your day?')).statusCode).toBe(200);
      // Replying where the other person wrote first is fine.
      const last = others[NEW_ACCOUNT_CHAT_STARTS + 1]!;
      expect((await say(last.member, last.matchId)).statusCode).toBe(200);
      expect((await say(me, last.matchId, 'Hi back!')).statusCode).toBe(200);
    });

    it('an account older than a day is not limited', async () => {
      const { me, others } = await matched(NEW_ACCOUNT_CHAT_STARTS + 1);
      await q(`UPDATE "user" SET created_at = now() - interval '25 hours' WHERE id = $1`, [me.id]);
      for (const o of others) expect((await say(me, o.matchId)).statusCode).toBe(200);
    });
  });
});
