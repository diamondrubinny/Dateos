// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { DAILY_INTERACTION_LIMIT, snapToGrid } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, discoverIds, places } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('discovery & matching (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  const woman = (name = 'Noa', extra = {}) =>
    createMember(ctx, { name, gender: 'woman', interestedIn: ['man'], ...extra });
  const man = (name = 'Dan', extra = {}) =>
    createMember(ctx, { name, gender: 'man', interestedIn: ['woman'], ...extra });

  it('requires location consent and stores only the snapped grid cell', async () => {
    const cookie = await signIn(ctx, 'loc@example.test');
    const put = () =>
      ctx.app.inject({
        method: 'PUT',
        url: '/v1/me/location',
        headers: { cookie },
        payload: { lat: 32.08123, lng: 34.78187 },
      });
    expect((await put()).statusCode).toBe(403);
    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/consents',
      headers: { cookie },
      payload: { consents: [{ kind: 'location', granted: true, version: '1' }] },
    });
    expect((await put()).statusCode).toBe(200);
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng FROM locations',
    );
    const cell = snapToGrid(32.08123, 34.78187);
    expect(rows[0].lat).toBeCloseTo(cell.lat, 6);
    expect(rows[0].lng).toBeCloseTo(cell.lng, 6);
    expect(rows[0].lat).not.toBeCloseTo(32.08123, 4);
  });

  it('adds a location step to onboarding until a location is set', async () => {
    const cookie = await signIn(ctx, 'steps@example.test');
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.json().onboarding.missing).toContain('location');
  });

  it('shows people only when both fit each other (gender, age, distance, intention)', async () => {
    const noa = await woman('Noa', { birthDate: '1995-01-01' });
    const dan = await man('Dan', { at: places.ramatGan });
    const gayMan = await createMember(ctx, { name: 'Omer', gender: 'man', interestedIn: ['man'] });
    const picky = await man('Avi', { prefs: { ageMin: 40, ageMax: 60, maxDistanceKm: 50 } });
    const far = await man('Yoni', { at: places.haifa });
    const casual = await man('Tom', { intention: 'short_term' });
    const noaPrefersSerious = await woman('Maya', {
      prefs: { ageMin: 18, ageMax: 99, maxDistanceKm: 50, intentions: ['long_term'] },
    });

    const noaSees = await discoverIds(ctx, noa);
    expect(noaSees).toContain(dan.id);
    expect(noaSees).toContain(casual.id); // Noa has no intention filter
    expect(noaSees).not.toContain(gayMan.id); // Omer is not interested in women
    expect(noaSees).not.toContain(picky.id); // Noa (31) is outside Avi's 40-60
    expect(noaSees).not.toContain(far.id); // 80 km away
    expect(await discoverIds(ctx, picky)).not.toContain(noa.id); // symmetric
    expect(await discoverIds(ctx, gayMan)).not.toContain(noa.id);
    expect(await discoverIds(ctx, noaPrefersSerious)).not.toContain(casual.id);
    expect(await discoverIds(ctx, casual)).not.toContain(noaPrefersSerious.id); // symmetric intention filter
  });

  it('returns bucketed distances and reasons, never exact location or private fields', async () => {
    const noa = await woman();
    await man('Dan', { at: places.ramatGan });
    const res = await api(ctx, noa, 'GET', '/v1/discover');
    const [profile] = res.json().profiles;
    expect(profile.distance).toBe('lt5');
    expect(profile.reasons).toContain('same_intention');
    const body = res.body;
    for (const forbidden of ['birthDate', 'email', 'lat', 'lng', 'geo', 'interestedIn'])
      expect(body).not.toContain(`"${forbidden}"`);
  });

  it('creates a match on mutual likes and lists likes before that', async () => {
    const noa = await woman();
    const dan = await man();
    const first = await api(ctx, dan, 'POST', '/v1/interactions', {
      targetId: noa.id,
      kind: 'like',
      itemType: 'prompt',
      itemId: noa.promptId,
      comment: 'Same here!',
    });
    expect(first.json()).toEqual({ matched: false, matchId: null });

    const likes = (await api(ctx, noa, 'GET', '/v1/likes')).json().likes;
    expect(likes).toHaveLength(1);
    expect(likes[0]).toMatchObject({
      comment: 'Same here!',
      itemType: 'prompt',
      itemId: noa.promptId,
      promptKey: 'green_flag',
      profile: { id: dan.id },
    });

    const back = await api(ctx, noa, 'POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    expect(back.json().matched).toBe(true);
    for (const m of [noa, dan]) {
      const list = (await api(ctx, m, 'GET', '/v1/matches')).json().matches;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(back.json().matchId);
    }
    expect((await api(ctx, noa, 'GET', '/v1/likes')).json().likes).toHaveLength(0);
    expect(await discoverIds(ctx, noa)).not.toContain(dan.id);
  });

  it('stores match pairs in JavaScript sort order regardless of database collation', async () => {
    // Regression: with en_US collation 'Zb' > 'ab', but JS sorts 'Zb' first. Mixed-case ids are normal.
    const pool = ctx.services.dbHandle.pool;
    await pool.query(
      `INSERT INTO "user" (id, email) VALUES ('Zb', 'zb@example.test'), ('ab', 'ab@example.test')`,
    );
    const [a, b] = ['ab', 'Zb'].sort();
    await expect(
      pool.query('INSERT INTO matches (user_a, user_b) VALUES ($1, $2)', [a, b]),
    ).resolves.toBeDefined();
  });

  it('rejects interactions with invisible people, foreign items and duplicates', async () => {
    const noa = await woman();
    const dan = await man();
    const omer = await createMember(ctx, { name: 'Omer', gender: 'man', interestedIn: ['man'] });
    expect(
      (await api(ctx, noa, 'POST', '/v1/interactions', { targetId: omer.id, kind: 'like' }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await api(ctx, noa, 'POST', '/v1/interactions', {
          targetId: 'does-not-exist',
          kind: 'like',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api(ctx, noa, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' }))
        .statusCode,
    ).toBe(404);
    const foreignItem = await api(ctx, noa, 'POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
      itemType: 'photo',
      itemId: omer.photoId,
    });
    expect(foreignItem.statusCode).toBe(400);
    expect(
      (await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'pass' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' }))
        .statusCode,
    ).toBe(409);
  });

  it('limits profile and photo access to people allowed to see each other (no IDOR)', async () => {
    const noa = await woman();
    const dan = await man();
    const omer = await createMember(ctx, { name: 'Omer', gender: 'man', interestedIn: ['man'] });
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(200);
    expect((await api(ctx, dan, 'GET', `/v1/photos/${noa.photoId}`)).statusCode).toBe(200);
    expect((await api(ctx, omer, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(404);
    expect((await api(ctx, omer, 'GET', `/v1/photos/${noa.photoId}`)).statusCode).toBe(404);
  });

  it('people outside each other’s filters can neither see nor like each other', async () => {
    const noa = await woman('Noa', { prefs: { ageMin: 18, ageMax: 30, maxDistanceKm: 50 } });
    const older = await man('Eli', { birthDate: '1980-01-01' });
    expect(await discoverIds(ctx, noa)).not.toContain(older.id);
    // Noa's age filter excludes Eli, so the pair is not mutually visible: liking her is a 404.
    expect(
      (await api(ctx, older, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' }))
        .statusCode,
    ).toBe(404);
  });

  it('blocks hide people in both directions everywhere and end the match', async () => {
    const noa = await woman();
    const dan = await man();
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    expect((await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id })).statusCode).toBe(200);

    for (const [viewer, other] of [
      [noa, dan],
      [dan, noa],
    ] as const) {
      expect(await discoverIds(ctx, viewer)).not.toContain(other.id);
      expect((await api(ctx, viewer, 'GET', `/v1/profiles/${other.id}`)).statusCode).toBe(404);
      expect((await api(ctx, viewer, 'GET', `/v1/photos/${other.photoId}`)).statusCode).toBe(404);
      expect((await api(ctx, viewer, 'GET', '/v1/matches')).json().matches).toHaveLength(0);
    }
    // Blocking an unknown id looks identical, so it cannot be used to probe accounts.
    expect((await api(ctx, noa, 'POST', '/v1/blocks', { userId: 'nobody-here' })).statusCode).toBe(
      200,
    );
  });

  it('unmatching hides both people from each other', async () => {
    const noa = await woman();
    const dan = await man();
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json();
    expect((await api(ctx, dan, 'DELETE', `/v1/matches/${matchId}`)).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', `/v1/profiles/${dan.id}`)).statusCode).toBe(404);
    expect((await api(ctx, dan, 'GET', `/v1/photos/${noa.photoId}`)).statusCode).toBe(404);
    expect((await api(ctx, noa, 'DELETE', `/v1/matches/${matchId}`)).statusCode).toBe(404);
  });

  it('only participants can unmatch', async () => {
    const noa = await woman();
    const dan = await man();
    const eve = await woman('Eve');
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json();
    expect((await api(ctx, eve, 'DELETE', `/v1/matches/${matchId}`)).statusCode).toBe(404);
    expect((await api(ctx, noa, 'GET', '/v1/matches')).json().matches).toHaveLength(1);
  });

  it('keeps Daily Picks stable for the day and drops people you decided on', async () => {
    const noa = await woman();
    const men = await Promise.all(['A', 'B', 'C'].map((n) => man(`Man${n}`)));
    const first = (await api(ctx, noa, 'GET', '/v1/picks/today'))
      .json()
      .profiles.map((p: { id: string }) => p.id);
    expect(first).toHaveLength(3);
    expect(
      (await api(ctx, noa, 'GET', '/v1/picks/today'))
        .json()
        .profiles.map((p: { id: string }) => p.id),
    ).toEqual(first);
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: first[0], kind: 'pass' });
    const after = (await api(ctx, noa, 'GET', '/v1/picks/today'))
      .json()
      .profiles.map((p: { id: string }) => p.id);
    expect(after).toEqual(first.slice(1));
    // Picks are not repeated in the discover feed the same day.
    expect(await discoverIds(ctx, noa)).toEqual([]);
    expect(men).toHaveLength(3);
  });

  it('enforces the daily interaction cap', async () => {
    const noa = await woman();
    const dan = await man();
    await ctx.services.dbHandle.pool.query(
      `INSERT INTO "user" (id, email) SELECT 'bulk-' || g, 'bulk-' || g || '@example.test' FROM generate_series(1, $1) g`,
      [DAILY_INTERACTION_LIMIT],
    );
    await ctx.services.dbHandle.pool.query(
      `INSERT INTO interactions (actor_id, target_id, kind) SELECT $1, 'bulk-' || g, 'pass' FROM generate_series(1, $2) g`,
      [noa.id, DAILY_INTERACTION_LIMIT],
    );
    const res = await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    expect(res.statusCode).toBe(429);
  });

  it('queues an embedding when the profile text changes', async () => {
    const noa = await woman();
    expect(ctx.jobs.embed.filter((id) => id === noa.id).length).toBeGreaterThanOrEqual(2); // profile + prompts
  });

  it('deleting an account removes all discovery data', async () => {
    const noa = await woman();
    const dan = await man();
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, noa, 'GET', '/v1/picks/today');
    await api(ctx, noa, 'DELETE', '/v1/me');
    const { rows } = await ctx.services.dbHandle.pool.query(
      `
      SELECT (SELECT count(*) FROM locations WHERE user_id = $1)::int AS loc,
             (SELECT count(*) FROM interactions WHERE actor_id = $1 OR target_id = $1)::int AS inter,
             (SELECT count(*) FROM daily_picks WHERE user_id = $1 OR candidate_id = $1)::int AS picks,
             (SELECT count(*) FROM impressions WHERE viewer_id = $1 OR candidate_id = $1)::int AS imp`,
      [noa.id],
    );
    expect(rows[0]).toEqual({ loc: 0, inter: 0, picks: 0, imp: 0 });
  });
});

describe.skipIf(!integrationEnabled)('profile embedding queue (integration)', () => {
  it('re-embeds after every edit, not only the first (completed jobs must not block new ones)', async () => {
    const { Worker } = await import('bullmq');
    const { Redis } = await import('ioredis');
    const { createProfileQueue } = await import('../../src/lib/queue.js');
    const { existsSync } = await import('node:fs');
    const envFile = new URL('../../../../.env', import.meta.url);
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    const isolated = new URL(process.env.REDIS_URL!);
    isolated.pathname = '/15'; // never the developer's Redis database
    const redisUrl = isolated.toString();
    const name = `embed-test-${Date.now()}`;
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    let runs = 0;
    const worker = new Worker(name, async () => void (runs += 1), { connection });
    const queue = createProfileQueue(redisUrl, name);
    for (let edit = 0; edit < 2; edit += 1) {
      await queue.embedProfile('u1');
      await new Promise((r) => setTimeout(r, 3_000)); // 2 s debounce + processing
    }
    expect(runs).toBe(2);
    await worker.close();
    await queue.close();
    connection.disconnect();
  }, 15_000);
});
