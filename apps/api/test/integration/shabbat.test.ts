// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { SHABBAT_CONSENT_VERSION } from '@nexaheart/shared';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendPush } from '../../../worker/src/push.js';
import { releaseRests } from '../../../worker/src/shabbat-jobs.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

/** Times in Tel Aviv (where test members live): Shabbat 6-7 November 2026. */
const FRIDAY_NOON = Date.parse('2026-11-06T12:00:00+02:00');
const SATURDAY_NOON = Date.parse('2026-11-07T12:00:00+02:00');
const SATURDAY_NIGHT = Date.parse('2026-11-07T21:00:00+02:00');

describe.skipIf(!integrationEnabled)('Shabbat and holiday mode (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const consent = (m: Member, granted: boolean) =>
    api(ctx, m, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'shabbat', granted, version: SHABBAT_CONSENT_VERSION }],
    });
  const resting = async (m: Member) =>
    (
      (await api(ctx, m, 'GET', '/v1/conversations')).json().conversations as {
        resting: { until: string; kind: string } | null;
      }[]
    )[0]!.resting;
  const push = (userId: string, kind: 'message' | 'checkin' | 'call', at: number) =>
    sendPush(
      {
        db: ctx.services.dbHandle.db,
        redis: ctx.redis,
        log: { info: () => undefined, warn: () => undefined },
        provider: 'expo',
        expoUrl: 'http://127.0.0.1:9/push',
        expoAccessToken: 'test',
        now: () => at,
      },
      { userId, kind, matchId },
    );

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
    ctx.clock.value = FRIDAY_NOON;
  });

  it('needs its own consent; the settings and the next rest', async () => {
    const off = (await api(ctx, noa, 'GET', '/v1/me/shabbat')).json();
    expect(off).toMatchObject({
      on: false,
      showMatches: false,
      candles: 18,
      located: true,
      next: null,
    });
    expect((await api(ctx, noa, 'PUT', '/v1/me/shabbat', { on: true })).statusCode).toBe(403);
    // The faith profile's consent isn't this one.
    await api(ctx, noa, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'religion', granted: true, version: '1' }],
    });
    expect((await api(ctx, noa, 'PUT', '/v1/me/shabbat', { on: true })).statusCode).toBe(403);

    expect((await consent(noa, true)).statusCode).toBe(200);
    expect((await api(ctx, noa, 'PUT', '/v1/me/shabbat', { candles: 25 })).statusCode).toBe(400);
    expect(
      (await api(ctx, noa, 'PUT', '/v1/me/shabbat', { timeZone: 'Mars/Olympus' })).statusCode,
    ).toBe(400);
    const on = await api(ctx, noa, 'PUT', '/v1/me/shabbat', {
      on: true,
      timeZone: 'Asia/Jerusalem',
      candles: 30,
    });
    expect(on.statusCode, on.body).toBe(200);
    const s = on.json();
    expect(s).toMatchObject({ on: true, candles: 30, located: true });
    expect(s.next.kind).toBe('shabbat');
    // Friday evening in Tel Aviv, 30 minutes before sunset (about 16:40 in November).
    const start = new Date(s.next.start);
    expect(start.toISOString().slice(0, 10)).toBe('2026-11-06');
    expect(start.getUTCHours()).toBe(14);
    expect(new Date(s.next.end).toISOString().slice(0, 10)).toBe('2026-11-07');

    // In the export, and withdrawing the consent turns it off and forgets the settings.
    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    expect(strFromU8(zip['data.json']!)).toContain('"shabbatMode": true');
    await consent(noa, false);
    expect((await api(ctx, noa, 'GET', '/v1/me/shabbat')).json()).toMatchObject({
      on: false,
      candles: 18,
    });
    const { rows } = await q(
      `SELECT action FROM audit_logs WHERE action LIKE 'shabbat.%' AND actor_id = $1`,
      [noa.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['shabbat.on']);
  });

  it('matches see it only while resting, and only when chosen', async () => {
    await consent(noa, true);
    await api(ctx, noa, 'PUT', '/v1/me/shabbat', { on: true, timeZone: 'Asia/Jerusalem' });
    ctx.clock.value = SATURDAY_NOON;
    expect(await resting(dan)).toBeNull(); // not chosen
    await api(ctx, noa, 'PUT', '/v1/me/shabbat', { showMatches: true });
    const r = await resting(dan);
    expect(r).toMatchObject({ kind: 'shabbat' });
    expect(new Date(r!.until).getTime()).toBeGreaterThan(SATURDAY_NOON);
    expect(await resting(noa)).toBeNull(); // Dan doesn't keep it
    ctx.clock.value = FRIDAY_NOON;
    expect(await resting(dan)).toBeNull();
    ctx.clock.value = SATURDAY_NIGHT;
    expect(await resting(dan)).toBeNull();
  });

  it('holds notifications during the rest (check-ins still come), then tells once after', async () => {
    await consent(noa, true);
    await api(ctx, noa, 'PUT', '/v1/me/shabbat', { on: true, timeZone: 'Asia/Jerusalem' });
    // Before Shabbat: as usual (no device here, so "no-devices").
    expect(await push(noa.id, 'message', FRIDAY_NOON)).toBe('no-devices');
    expect(await push(noa.id, 'message', SATURDAY_NOON)).toBe('resting');
    expect(await push(noa.id, 'call', SATURDAY_NOON)).toBe('resting');
    expect(await push(noa.id, 'checkin', SATURDAY_NOON)).not.toBe('resting');
    expect(
      (await q('SELECT shabbat_held FROM preferences WHERE user_id = $1', [noa.id])).rows[0],
    ).toEqual({ shabbat_held: true });
    // Dan isn't in Shabbat mode: his pushes go.
    expect(await push(dan.id, 'message', SATURDAY_NOON)).not.toBe('resting');

    const told: string[] = [];
    const notify = async (id: string) => {
      told.push(id);
    };
    // Still Shabbat: nothing yet; after nightfall: once.
    expect(await releaseRests(ctx.services.dbHandle.db, notify, SATURDAY_NOON)).toEqual({
      released: 0,
    });
    expect(await releaseRests(ctx.services.dbHandle.db, notify, SATURDAY_NIGHT)).toEqual({
      released: 1,
    });
    expect(await releaseRests(ctx.services.dbHandle.db, notify, SATURDAY_NIGHT)).toEqual({
      released: 0,
    });
    expect(told).toEqual([noa.id]);
    // The "welcome back" notification itself goes out after the rest.
    expect(
      await sendPush(
        {
          db: ctx.services.dbHandle.db,
          redis: ctx.redis,
          log: { info: () => undefined, warn: () => undefined },
          provider: 'expo',
          expoUrl: 'http://127.0.0.1:9/push',
          now: () => SATURDAY_NIGHT,
        },
        { userId: noa.id, kind: 'after_rest', matchId: noa.id },
      ),
    ).toBe('no-devices');

    // Turned off: nothing held, nothing told.
    expect(await push(noa.id, 'message', SATURDAY_NOON)).toBe('resting');
    await api(ctx, noa, 'PUT', '/v1/me/shabbat', { on: false });
    expect(await push(noa.id, 'message', SATURDAY_NOON)).toBe('no-devices');
    expect(await releaseRests(ctx.services.dbHandle.db, notify, SATURDAY_NIGHT)).toEqual({
      released: 0,
    });
  });
});
