// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { accountActivitySchema } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendPush } from '../../../worker/src/push.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

describe.skipIf(!integrationEnabled)('account activity, mute and archive (integration)', () => {
  let ctx: TestContext;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  describe('account activity', () => {
    const activity = async (cookie: string) =>
      accountActivitySchema.parse(
        (
          await ctx.app.inject({ method: 'GET', url: '/v1/me/activity', headers: { cookie } })
        ).json(),
      ).events;

    it('lists my sign-ins, sign-outs and downloads, newest first, and nobody else’s', async () => {
      const laptop = await signIn(ctx, 'noa@example.test', { userAgent: FIREFOX });
      const phone = await signIn(ctx, 'noa@example.test', { userAgent: 'okhttp/4.12.0' });
      const dan = await signIn(ctx, 'dan@example.test');
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/me/sessions/sign-out-others',
        headers: { cookie: laptop },
      });
      const events = await activity(laptop);
      expect(events.map((e) => e.kind)).toEqual(['signed_out_others', 'signed_in', 'signed_in']);
      expect(events[0]!.count).toBe(1);
      expect(events.map((e) => e.device?.kind).slice(1)).toEqual(['app', 'web']);
      // The stored meta is the coarse code only.
      const meta = await q(
        `SELECT meta FROM audit_logs WHERE action = 'session.created' AND meta IS NOT NULL`,
      );
      expect(meta.rows.every((r) => Object.keys(r.meta).join() === 'device')).toBe(true);
      // Staff's audit view doesn't list members' sign-ins.
      const entries = await ctx.services.moderation.auditLog(undefined, 50);
      expect(entries.some((e) => e.action === 'session.created')).toBe(false);
      // Dan sees only his own sign-in.
      expect((await activity(dan)).map((e) => e.kind)).toEqual(['signed_in']);
      // The phone was signed out.
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: phone } }))
          .statusCode,
      ).toBe(401);
    });

    it('keeps 90 days and only the allowed actions', async () => {
      const noa = await signIn(ctx, 'noa@example.test');
      const id = (
        await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: noa } })
      ).json().user.id as string;
      await q(
        `INSERT INTO audit_logs (actor_id, action, created_at) VALUES ($1, 'session.created', now() - interval '91 days'), ($1, 'staff.note_added', now())`,
        [id],
      );
      expect((await activity(noa)).map((e) => e.kind)).toEqual(['signed_in']);
    });
  });

  describe('mute and archive', () => {
    let noa: Member;
    let dan: Member;
    let matchId: string;
    beforeEach(async () => {
      noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
      matchId = (
        await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
      ).json().matchId;
    });
    const inbox = async (m: Member) =>
      (await api(ctx, m, 'GET', '/v1/conversations')).json().conversations as {
        matchId: string;
        muted: boolean;
        archived: boolean;
      }[];
    const prefs = (m: Member, body: object, id = matchId) =>
      api(ctx, m, 'PUT', `/v1/matches/${id}/prefs`, body);

    it('are private, and a new message brings an archived chat back', async () => {
      expect((await prefs(noa, { muted: true, archived: true })).json()).toEqual({
        muted: true,
        archived: true,
        pinned: false,
      });
      expect(await inbox(noa)).toEqual([
        expect.objectContaining({ matchId, muted: true, archived: true }),
      ]);
      // Dan sees nothing of it.
      expect(await inbox(dan)).toEqual([
        expect.objectContaining({ matchId, muted: false, archived: false }),
      ]);
      await api(ctx, dan, 'POST', `/v1/matches/${matchId}/messages`, {
        text: 'Still there?',
        clientId: `c-${Date.now()}`,
      });
      expect(await inbox(noa)).toEqual([expect.objectContaining({ muted: true, archived: false })]);
    });

    it('a muted chat sends no message pushes, but calls still ring', async () => {
      await prefs(noa, { muted: true });
      const context = {
        db: ctx.services.dbHandle.db,
        redis: ctx.redis,
        log: { info: () => undefined, warn: () => undefined },
        provider: 'expo' as const,
        expoUrl: 'http://127.0.0.1:9/push',
        expoAccessToken: 'test',
      };
      expect(await sendPush(context, { userId: noa.id, kind: 'message', matchId })).toBe('muted');
      expect(await sendPush(context, { userId: noa.id, kind: 'call', matchId })).toBe('no-devices');
    });

    it('pinned chats come first, up to 3; pinning unarchives and archiving unpins', async () => {
      // Noa has four more matches, each with a newer message than the first chat.
      const others: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const m = await createMember(ctx, {
          name: `Man${i}`,
          gender: 'man',
          interestedIn: ['woman'],
        });
        await api(ctx, m, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
        const id = (
          await api(ctx, noa, 'POST', '/v1/interactions', { targetId: m.id, kind: 'like' })
        ).json().matchId as string;
        await api(ctx, m, 'POST', `/v1/matches/${id}/messages`, {
          text: `Hi Noa ${i}`,
          clientId: `pin-${Date.now()}-${i}`,
        });
        others.push(id);
      }
      expect((await inbox(noa))[0]!.matchId).not.toBe(matchId);

      await prefs(noa, { archived: true });
      expect((await prefs(noa, { pinned: true })).json()).toEqual({
        muted: false,
        archived: false,
        pinned: true,
      });
      ctx.clock.value += 1000;
      await prefs(noa, { pinned: true }, others[0]);
      ctx.clock.value += 1000;
      await prefs(noa, { pinned: true }, others[1]);
      // Most recently pinned first, then the rest by activity.
      const order = (await inbox(noa)).map((c) => c.matchId);
      expect(order.slice(0, 3)).toEqual([others[1], others[0], matchId]);
      // Pinning the same chat again is fine; a 4th is refused.
      expect((await prefs(noa, { pinned: true }, others[1])).statusCode).toBe(200);
      expect((await prefs(noa, { pinned: true }, others[2])).statusCode).toBe(409);
      // Archiving unpins, which frees a place.
      expect((await prefs(noa, { archived: true }, others[0])).json()).toMatchObject({
        archived: true,
        pinned: false,
      });
      expect((await prefs(noa, { pinned: true }, others[2])).statusCode).toBe(200);
      // Dan never sees Noa's pins.
      expect(await inbox(dan)).toEqual([expect.objectContaining({ matchId, pinned: false })]);
    });

    it('only for a member of the chat, and something must change', async () => {
      const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
      expect((await prefs(eve, { muted: true })).statusCode).toBe(404);
      expect((await prefs(noa, {})).statusCode).toBe(400);
    });
  });
});
