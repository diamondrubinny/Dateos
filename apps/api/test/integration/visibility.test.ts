// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { SENSITIVE_CONSENT_VERSION } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processPauses } from '../../../worker/src/pause-jobs.js';
import { processTrips } from '../../../worker/src/travel-jobs.js';
import { api, createMember, discoverIds, places, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('who sees me: take a break (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  const woman = (name = 'Noa', at = places.telAviv) =>
    createMember(ctx, { name, gender: 'woman', interestedIn: ['man'], at });
  const man = (name = 'Dan', at = places.telAviv) =>
    createMember(ctx, { name, gender: 'man', interestedIn: ['woman'], at });
  const pause = (m: Member, duration: string) => api(ctx, m, 'PUT', '/v1/me/pause', { duration });
  const me = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me')).json();
  const query = (text: string, values: unknown[] = []) =>
    ctx.services.dbHandle.pool.query(text, values);

  it('hides a member on a break from new people, everywhere, and shows the break in /v1/me', async () => {
    const noa = await woman();
    const dan = await man();
    const omer = await man('Omer');
    // Dan liked Noa before her break; Omer never met her.
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    expect(await discoverIds(ctx, omer)).toContain(noa.id);

    expect((await pause(noa, '3d')).statusCode).toBe(200);
    const state = (await me(noa)).pause;
    expect(state.until).not.toBeNull();
    const hours = (Date.parse(state.until) - Date.parse(state.since)) / 3_600_000;
    expect(hours).toBe(72);

    // New people: not in discover, not as a profile, not as photos, can't be liked.
    expect(await discoverIds(ctx, omer)).not.toContain(noa.id);
    expect((await api(ctx, omer, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(404);
    expect((await api(ctx, omer, 'GET', `/v1/photos/${noa.photoId}`)).statusCode).toBe(404);
    expect(
      (await api(ctx, omer, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' }))
        .statusCode,
    ).toBe(404);
    // Her own feeds are calm: nothing to browse, no likes to answer, no liking.
    expect(await discoverIds(ctx, noa)).toEqual([]);
    expect((await api(ctx, noa, 'GET', '/v1/picks/today')).json().profiles).toEqual([]);
    expect((await api(ctx, noa, 'GET', '/v1/likes')).json().likes).toEqual([]);
    expect(
      (await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' }))
        .statusCode,
    ).toBe(403);

    // Coming back: everything returns, including Dan's like waiting for her.
    expect((await api(ctx, noa, 'DELETE', '/v1/me/pause')).statusCode).toBe(200);
    expect((await me(noa)).pause).toBeNull();
    expect(await discoverIds(ctx, omer)).toContain(noa.id);
    const likes = (await api(ctx, noa, 'GET', '/v1/likes')).json().likes;
    expect(likes.map((l: { profile: { id: string } }) => l.profile.id)).toEqual([dan.id]);
  });

  it('hides a liker who takes a break from Likes You, but keeps matches and chats going', async () => {
    const noa = await woman();
    const dan = await man();
    const omer = await man('Omer');
    await api(ctx, omer, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;

    await pause(omer, 'indefinite');
    await pause(dan, 'indefinite');
    expect((await me(dan)).pause.until).toBeNull();
    // Omer's waiting like disappears while he's away...
    expect((await api(ctx, noa, 'GET', '/v1/likes')).json().likes).toEqual([]);
    expect((await api(ctx, noa, 'GET', `/v1/profiles/${omer.id}`)).statusCode).toBe(404);
    // ...but Noa and Dan still see each other and can talk.
    expect((await api(ctx, noa, 'GET', '/v1/matches')).json().matches).toHaveLength(1);
    expect((await api(ctx, noa, 'GET', `/v1/profiles/${dan.id}`)).statusCode).toBe(200);
    const sent = await api(ctx, dan, 'POST', `/v1/matches/${matchId}/messages`, {
      text: 'Still here, just taking a break from new people',
      clientId: 'break-message-1',
    });
    expect(sent.statusCode).toBe(200);
  });

  it('ends a break by itself, tells the member once, and never overrides a missing consent', async () => {
    const noa = await woman();
    const omer = await man('Omer');
    await pause(noa, '24h');
    // The time is up: visible at once, before the worker runs.
    await query(`UPDATE "user" SET paused_until = now() - interval '1 minute' WHERE id = $1`, [
      noa.id,
    ]);
    expect((await me(noa)).pause).toBeNull();
    expect(await discoverIds(ctx, omer)).toContain(noa.id);

    const told: string[] = [];
    const sweep = () =>
      processPauses({
        db: ctx.services.dbHandle.db,
        tellVisible: async (id) => void told.push(id),
      });
    expect(await sweep()).toEqual({ ended: 1 });
    expect(await sweep()).toEqual({ ended: 0 });
    expect(told).toEqual([noa.id]);
    const { rows } = await query('SELECT paused_at, paused_until FROM "user" WHERE id = $1', [
      noa.id,
    ]);
    expect(rows[0]).toEqual({ paused_at: null, paused_until: null });

    // An indefinite break is never ended by the worker.
    await pause(omer, 'indefinite');
    expect(await sweep()).toEqual({ ended: 0 });

    // Ending a break doesn't bring back someone hidden for a withdrawn consent.
    await api(ctx, noa, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'sensitive', granted: false, version: SENSITIVE_CONSENT_VERSION }],
    });
    await pause(noa, '24h');
    await api(ctx, noa, 'DELETE', '/v1/me/pause');
    expect((await me(noa)).user.status).toBe('paused');
    await api(ctx, omer, 'DELETE', '/v1/me/pause');
    expect(await discoverIds(ctx, omer)).not.toContain(noa.id);
  });

  it('incognito: only people I liked see me, matches stay, and nobody is told', async () => {
    const noa = await woman();
    const dan = await man();
    const omer = await man('Omer');
    const gil = await man('Gil');
    // Gil and Noa matched before she went incognito.
    await api(ctx, gil, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: gil.id, kind: 'like' });

    expect((await api(ctx, noa, 'PUT', '/v1/me/incognito', { on: true })).statusCode).toBe(200);
    expect((await me(noa)).incognito).toBe(true);
    for (const viewer of [dan, omer]) {
      expect(await discoverIds(ctx, viewer)).not.toContain(noa.id);
      expect((await api(ctx, viewer, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(404);
      expect((await api(ctx, viewer, 'GET', `/v1/photos/${noa.photoId}`)).statusCode).toBe(404);
      expect(
        (await api(ctx, viewer, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' }))
          .statusCode,
      ).toBe(404);
    }
    // She still browses as usual.
    expect(await discoverIds(ctx, noa)).toEqual(expect.arrayContaining([dan.id, omer.id]));
    // Her match is untouched.
    expect((await api(ctx, gil, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(200);
    expect((await api(ctx, gil, 'GET', '/v1/matches')).json().matches).toHaveLength(1);

    // She likes Dan: now Dan (only Dan) can see her, in Likes You and on her profile.
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    const likes = (await api(ctx, dan, 'GET', '/v1/likes')).json().likes;
    expect(likes.map((l: { profile: { id: string } }) => l.profile.id)).toEqual([noa.id]);
    const profile = await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`);
    expect(profile.statusCode).toBe(200);
    expect(JSON.stringify(profile.json())).not.toMatch(/incognito/i);
    expect(await discoverIds(ctx, omer)).not.toContain(noa.id);
    // Dan can answer, and they match.
    expect(
      (await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' })).json()
        .matched,
    ).toBe(true);

    // Turning it off: visible to everyone again.
    await api(ctx, noa, 'PUT', '/v1/me/incognito', { on: false });
    expect(await discoverIds(ctx, omer)).toContain(noa.id);
    expect((await api(ctx, noa, 'PUT', '/v1/me/incognito', { on: 'yes' })).statusCode).toBe(400);
  });

  const HAIFA = 294801;
  const search = async (m: Member, q: string) =>
    (await api(ctx, m, 'GET', `/v1/places?q=${encodeURIComponent(q)}`)).json().places as {
      id: number;
      names: { en: string; he: string | null };
      country: string;
    }[];

  it('searches the bundled cities in every language, on our own server', async () => {
    const noa = await woman();
    expect((await search(noa, 'haifa'))[0]).toMatchObject({ id: HAIFA, country: 'IL' });
    expect((await search(noa, 'חיפה'))[0]?.id).toBe(HAIFA);
    expect((await search(noa, 'حيفا'))[0]?.id).toBe(HAIFA);
    expect((await search(noa, 'Хайфа'))[0]?.id).toBe(HAIFA);
    expect((await search(noa, 'tel-aviv'))[0]?.names.en).toBe('Tel Aviv');
    expect((await search(noa, 'נצרת'))[0]?.names.en).toBe('Nazareth');
    expect((await search(noa, 'berl'))[0]?.names.en).toBe('Berlin');
    expect(await search(noa, 'zzzzqqq')).toEqual([]);
    expect((await api(ctx, noa, 'GET', '/v1/places?q=a')).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/places?q=haifa' })).statusCode).toBe(
      401,
    );
  });

  it('travel mode: Discover works from the city, the profile says "Visiting", and home comes back', async () => {
    const noa = await woman('Noa', places.telAviv);
    const dan = await man('Dan', places.haifa);
    const omer = await man('Omer', places.telAviv);
    // At home in Tel Aviv: Omer is near, Dan in Haifa (~80 km) is too far.
    expect(await discoverIds(ctx, noa)).toEqual([omer.id]);

    const start = await api(ctx, noa, 'PUT', '/v1/me/travel', { cityId: HAIFA, days: 7 });
    expect(start.statusCode).toBe(200);
    const trip = start.json().travel;
    expect(trip).toMatchObject({ id: HAIFA, names: { en: 'Haifa', he: 'חיפה' }, country: 'IL' });
    expect(Math.round((Date.parse(trip.until) - Date.now()) / 86_400_000)).toBe(7);
    expect((await api(ctx, noa, 'GET', '/v1/me/travel')).json().travel.id).toBe(HAIFA);

    // In Haifa: Dan is near, Omer is not; and the other way round.
    expect(await discoverIds(ctx, noa)).toEqual([dan.id]);
    expect(await discoverIds(ctx, dan)).toContain(noa.id);
    expect(await discoverIds(ctx, omer)).not.toContain(noa.id);
    const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json();
    expect(seen.visiting).toMatchObject({ id: HAIFA, names: { en: 'Haifa' } });
    expect(seen.distance).toBeNull();
    // Her own home cell was never touched.
    const { rows } = await query(
      'SELECT ST_Distance(geo, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS m FROM locations WHERE user_id = $1',
      [noa.id, places.telAviv.lng, places.telAviv.lat],
    );
    expect(Number(rows[0].m)).toBeLessThan(1000);

    // The trip ends by itself: home again, at once.
    await query(
      `UPDATE locations SET travel_until = now() - interval '1 minute' WHERE user_id = $1`,
      [noa.id],
    );
    expect((await api(ctx, noa, 'GET', '/v1/me/travel')).json().travel).toBeNull();
    expect(await discoverIds(ctx, noa)).toEqual([omer.id]);
    expect((await api(ctx, omer, 'GET', `/v1/profiles/${noa.id}`)).json().visiting).toBeNull();
  });

  it('validates trips, limits them to 3 a day, ends them early and deletes old ones', async () => {
    // Invalid trips (every attempt counts towards the daily limit, so another member checks them).
    const dan = await man();
    const bad = (body: object) => api(ctx, dan, 'PUT', '/v1/me/travel', body);
    expect((await bad({ cityId: 999_999_999, days: 3 })).statusCode).toBe(400);
    expect((await bad({ cityId: HAIFA, days: 15 })).statusCode).toBe(400);
    expect((await bad({ cityId: HAIFA, days: 0 })).statusCode).toBe(400);

    const noa = await woman();
    const put = (body: object) => api(ctx, noa, 'PUT', '/v1/me/travel', body);
    expect((await put({ cityId: HAIFA, days: 3 })).statusCode).toBe(200);
    // Ending early deletes the trip at once.
    expect((await api(ctx, noa, 'DELETE', '/v1/me/travel')).statusCode).toBe(200);
    const none = await query(
      'SELECT travel_city_id, travel_geo FROM locations WHERE user_id = $1',
      [noa.id],
    );
    expect(none.rows[0]).toEqual({ travel_city_id: null, travel_geo: null });
    expect((await put({ cityId: HAIFA, days: 3 })).statusCode).toBe(200);
    expect((await put({ cityId: HAIFA, days: 3 })).statusCode).toBe(200);
    expect((await put({ cityId: HAIFA, days: 3 })).statusCode).toBe(429);

    // The export lists the trip; 30 days after it ends, it's deleted.
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    expect(zip.statusCode).toBe(200);
    await query(
      `UPDATE locations SET travel_until = now() - interval '31 days' WHERE user_id = $1`,
      [noa.id],
    );
    expect(await processTrips(ctx.services.dbHandle.db)).toEqual({ tripsDeleted: 1 });
    expect(await processTrips(ctx.services.dbHandle.db)).toEqual({ tripsDeleted: 0 });
  });

  it('needs a location before travelling', async () => {
    const noa = await woman();
    await api(ctx, noa, 'DELETE', '/v1/me/location');
    expect(
      (await api(ctx, noa, 'PUT', '/v1/me/travel', { cityId: HAIFA, days: 3 })).statusCode,
    ).toBe(409);
  });

  it('validates the duration and keeps the break in "Download my data"', async () => {
    const noa = await woman();
    expect((await pause(noa, '1y')).statusCode).toBe(400);
    expect((await api(ctx, noa, 'PUT', '/v1/me/pause', {})).statusCode).toBe(400);
    await pause(noa, '7d');
    const { rows } = await query(
      'SELECT paused_until - paused_at AS span FROM "user" WHERE id = $1',
      [noa.id],
    );
    expect(rows[0].span).toMatchObject({ days: 7 });
  });
});
