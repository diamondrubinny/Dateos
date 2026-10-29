// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_SAVED_PROFILES } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendPush } from '../../../worker/src/push.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('maybe later and notification choices (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  describe('maybe later', () => {
    const deck = async (m: Member) =>
      ((await api(ctx, m, 'GET', '/v1/discover')).json().profiles as { id: string }[]).map(
        (p) => p.id,
      );
    const saved = async (m: Member) =>
      ((await api(ctx, m, 'GET', '/v1/saved')).json().profiles as { id: string }[]).map(
        (p) => p.id,
      );

    it('puts a profile aside, privately, until a decision clears it', async () => {
      expect(await deck(noa)).toContain(dan.id);
      expect((await api(ctx, noa, 'POST', '/v1/saved', { targetId: dan.id })).statusCode).toBe(200);
      expect(await deck(noa)).not.toContain(dan.id);
      expect(await saved(noa)).toEqual([dan.id]);
      // Dan learns nothing: no like, nothing in his lists.
      expect((await api(ctx, dan, 'GET', '/v1/likes')).json()).not.toContain(noa.id);
      expect(await saved(dan)).toEqual([]);
      // Liking from the list clears it.
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
      expect(await saved(noa)).toEqual([]);
    });

    it('can be removed, and disappears when the profile can’t be shown', async () => {
      await api(ctx, noa, 'POST', '/v1/saved', { targetId: dan.id });
      await api(ctx, noa, 'DELETE', `/v1/saved/${dan.id}`);
      expect(await deck(noa)).toContain(dan.id);
      await api(ctx, noa, 'POST', '/v1/saved', { targetId: dan.id });
      await api(ctx, dan, 'POST', '/v1/blocks', { userId: noa.id });
      expect(await saved(noa)).toEqual([]);
    });

    it('only someone I may see, and at most 30', async () => {
      const zed = await createMember(ctx, { name: 'Zed', gender: 'man', interestedIn: ['man'] });
      expect((await api(ctx, noa, 'POST', '/v1/saved', { targetId: zed.id })).statusCode).toBe(404);
      expect((await api(ctx, noa, 'POST', '/v1/saved', { targetId: noa.id })).statusCode).toBe(404);
      // Fill the list directly, then one more is refused.
      const ids = Array.from({ length: MAX_SAVED_PROFILES }, (_, i) => `filler-${i}`);
      for (const id of ids) {
        await q(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $1, $1 || '@example.test', true, now(), now())`,
          [id],
        );
        await q('INSERT INTO saved_profiles (user_id, target_id) VALUES ($1, $2)', [noa.id, id]);
      }
      expect((await api(ctx, noa, 'POST', '/v1/saved', { targetId: dan.id })).statusCode).toBe(409);
    });
  });

  describe('notification choices', () => {
    const context = () => ({
      db: ctx.services.dbHandle.db,
      redis: ctx.redis,
      log: { info: () => undefined, warn: () => undefined },
      provider: 'expo' as const,
      expoUrl: 'http://127.0.0.1:9/push',
      expoAccessToken: 'test',
    });

    it('turned-off kinds are skipped; calls and safety check-ins never are', async () => {
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
      const matchId = (
        await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
      ).json().matchId as string;
      expect(
        (
          await api(ctx, noa, 'PUT', '/v1/me/settings', {
            notifyMatches: false,
            notifyMessages: false,
            notifyEvents: false,
          })
        ).statusCode,
      ).toBe(200);
      expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json()).toMatchObject({
        notifyMatches: false,
        notifyMessages: false,
        notifyEvents: false,
      });
      for (const kind of ['match', 'message', 'event', 'partner_message'] as const) {
        expect(await sendPush(context(), { userId: noa.id, kind, matchId })).toBe('off');
      }
      // Calls and safety alerts still go out (here: no device registered).
      expect(await sendPush(context(), { userId: noa.id, kind: 'call', matchId })).toBe(
        'no-devices',
      );
      expect(await sendPush(context(), { userId: noa.id, kind: 'checkin', matchId })).toBe(
        'no-devices',
      );
      // Dan's choices are his own.
      expect(await sendPush(context(), { userId: dan.id, kind: 'message', matchId })).toBe(
        'no-devices',
      );
    });

    it('quiet hours skip notifications in the member’s time zone; calls and check-ins still come', async () => {
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
      const matchId = (
        await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
      ).json().matchId as string;
      // A window around "now" in UTC, by the database clock (which the worker uses).
      const { rows } = await q(
        `SELECT (EXTRACT(HOUR FROM now() AT TIME ZONE 'UTC') * 60 + EXTRACT(MINUTE FROM now() AT TIME ZONE 'UTC'))::int AS m`,
      );
      const m = rows[0].m as number;
      const around = { start: (m + 1380) % 1440, end: (m + 60) % 1440, timeZone: 'UTC' };
      expect(
        (await api(ctx, noa, 'PUT', '/v1/me/settings', { quietHours: around })).statusCode,
      ).toBe(200);
      expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().quietHours).toEqual(around);
      for (const kind of ['match', 'message', 'event', 'visible'] as const) {
        expect(await sendPush(context(), { userId: noa.id, kind, matchId })).toBe('quiet');
      }
      for (const kind of ['call', 'checkin'] as const) {
        expect(await sendPush(context(), { userId: noa.id, kind, matchId })).toBe('no-devices');
      }
      // A window that excludes now (it may cross midnight either way).
      const later = { start: (m + 120) % 1440, end: (m + 180) % 1440, timeZone: 'UTC' };
      await api(ctx, noa, 'PUT', '/v1/me/settings', { quietHours: later });
      expect(await sendPush(context(), { userId: noa.id, kind: 'match', matchId })).not.toBe(
        'quiet',
      );
      // Off again.
      await api(ctx, noa, 'PUT', '/v1/me/settings', { quietHours: around });
      await api(ctx, noa, 'PUT', '/v1/me/settings', { quietHours: null });
      expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().quietHours).toBeNull();
      expect(await sendPush(context(), { userId: noa.id, kind: 'match', matchId })).not.toBe(
        'quiet',
      );
    });

    it('quiet hours must be a real window in a real time zone', async () => {
      const put = (quietHours: unknown) => api(ctx, noa, 'PUT', '/v1/me/settings', { quietHours });
      expect((await put({ start: 600, end: 600, timeZone: 'UTC' })).statusCode).toBe(400);
      expect((await put({ start: 1440, end: 60, timeZone: 'UTC' })).statusCode).toBe(400);
      expect((await put({ start: 1380, end: 420, timeZone: 'Mars/Olympus' })).statusCode).toBe(400);
      expect((await put({ start: 1380, end: 420, timeZone: 'Asia/Jerusalem' })).statusCode).toBe(
        200,
      );
    });

    it('ignores settings it doesn’t know', async () => {
      const res = await api(ctx, noa, 'PUT', '/v1/me/settings', {
        notifyMatches: true,
        role: 'admin',
      });
      expect(res.statusCode).toBe(200);
      expect((await q('SELECT role FROM "user" WHERE id = $1', [noa.id])).rows[0].role).toBe(
        'user',
      );
    });
  });
});
