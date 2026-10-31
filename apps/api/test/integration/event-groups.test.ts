// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
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

describe.skipIf(!integrationEnabled)(
  'events for a group and places by gender, phase 71b (integration)',
  () => {
    let ctx: TestContext;
    let admin: string;
    let venueId: string;
    let n = 0;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    const at = (minutes: number) => new Date(ctx.clock.value + minutes * 60_000).toISOString();
    const thisYear = () => new Date(ctx.clock.value).getUTCFullYear();
    /** Born on 1 January this many years ago (so their age is exactly that). */
    const born = (age: number) => `${thisYear() - age}-01-01`;
    const member = (name: string, gender: 'woman' | 'man' | 'nonbinary', age = 31) =>
      createMember(ctx, {
        name,
        gender,
        interestedIn: gender === 'woman' ? ['man'] : ['woman'],
        birthDate: born(age),
      });

    async function staff() {
      const email = `admin-${(n += 1)}@example.test`;
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
      return cookie;
    }
    const asAdmin = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
      ctx.app.inject({ method, url, headers: { cookie: admin }, ...(payload ? { payload } : {}) });
    async function publish(over: Record<string, unknown> = {}) {
      const res = await asAdmin('POST', '/v1/admin/events', {
        title: 'Singles evening',
        venueId,
        startsAt: at(24 * 60),
        endsAt: at(26 * 60),
        ...over,
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json();
    }
    const view = async (m: Member, id: string) =>
      (await api(ctx, m, 'GET', `/v1/events/${id}`)).json();
    const rsvp = (m: Member, id: string) => api(ctx, m, 'POST', `/v1/events/${id}/rsvp`);
    const waitlist = (m: Member, id: string) => api(ctx, m, 'POST', `/v1/events/${id}/waitlist`);

    beforeAll(async () => {
      ctx = await setupIntegration();
    });
    afterAll(async () => teardown(ctx));
    beforeEach(async () => {
      await resetState(ctx);
      ctx.clock.value = Date.now();
      admin = await staff();
      venueId = (
        await asAdmin('POST', '/v1/admin/venues', {
          name: 'Cafe Nord',
          area: 'Tel Aviv',
          category: 'cafe',
          address: 'Dizengoff 1',
        })
      ).json().id;
    });

    it('who it is for: gender, age and (with the faith module and a stream) stream', async () => {
      const noa = await member('Noa', 'woman', 31);
      const maya = await member('Maya', 'woman', 22);
      const dan = await member('Dan', 'man', 31);
      const event = await publish({ audience: { genders: ['woman'], ageMin: 25, ageMax: 35 } });
      expect(event.audience).toEqual({
        genders: ['woman'],
        ageMin: 25,
        ageMax: 35,
        faithStreams: [],
      });
      expect((await view(noa, event.id)).notForYou).toBeNull();
      expect((await view(maya, event.id)).notForYou).toBe('age');
      expect((await view(dan, event.id)).notForYou).toBe('gender');
      // Everyone sees it; only people it's for can take a place (or wait for one).
      expect((await rsvp(maya, event.id)).statusCode).toBe(403);
      expect((await waitlist(dan, event.id)).statusCode).toBe(403);
      expect((await rsvp(noa, event.id)).statusCode).toBe(200);

      // Streams: only with the faith module on, and only for a stream given with the consent.
      const streams = { audience: { faithStreams: ['dati_leumi'] } };
      expect(
        (
          await asAdmin('POST', '/v1/admin/events', {
            title: 'Dati leumi evening',
            venueId,
            startsAt: at(24 * 60),
            endsAt: at(26 * 60),
            ...streams,
          })
        ).statusCode,
      ).toBe(422);
      await q(`INSERT INTO instance_settings (id, faith_module) VALUES (1, true)
             ON CONFLICT (id) DO UPDATE SET faith_module = true`);
      const religious = await publish(streams);
      expect((await view(noa, religious.id)).notForYou).toBe('faith');
      expect((await rsvp(noa, religious.id)).statusCode).toBe(403);
      await q(
        `INSERT INTO profile_about (user_id, faith, faith_stream) VALUES ($1, 'jewish', 'dati_leumi')
       ON CONFLICT (user_id) DO UPDATE SET faith = 'jewish', faith_stream = 'dati_leumi'`,
        [noa.id],
      );
      expect((await view(noa, religious.id)).notForYou).toBeNull();
      expect((await rsvp(noa, religious.id)).statusCode).toBe(200);

      // Bad input.
      const bad = (audience: object) =>
        asAdmin('POST', '/v1/admin/events', {
          title: 'Bad',
          venueId,
          startsAt: at(60),
          endsAt: at(120),
          audience,
        });
      expect((await bad({ ageMin: 40, ageMax: 30 })).statusCode).toBe(400);
      expect((await bad({ genders: ['alien'] })).statusCode).toBe(400);
      expect((await bad({ ageMin: 12 })).statusCode).toBe(400);
    });

    it('places by gender: separate counts, a waiting list each, a freed place stays in its group', async () => {
      const event = await publish({
        pools: [
          { gender: 'woman', capacity: 2 },
          { gender: 'man', capacity: 2 },
        ],
      });
      expect(event.capacity).toBe(4);
      const [noa, maya, tal] = [
        await member('Noa', 'woman'),
        await member('Maya', 'woman'),
        await member('Tal', 'woman'),
      ];
      const [dan, gil, eli] = [
        await member('Dan', 'man'),
        await member('Gil', 'man'),
        await member('Eli', 'man'),
      ];
      const sam = await member('Sam', 'nonbinary');
      for (const m of [noa, maya, dan]) expect((await rsvp(m, event.id)).statusCode).toBe(200);
      // Women are full, men aren't: "full" is about my own group.
      expect((await view(tal, event.id)).full).toBe(true);
      expect((await view(gil, event.id)).full).toBe(false);
      expect((await rsvp(tal, event.id)).statusCode).toBe(409);
      expect((await waitlist(tal, event.id)).statusCode).toBe(200);
      expect((await rsvp(gil, event.id)).statusCode).toBe(200);
      expect((await waitlist(eli, event.id)).statusCode).toBe(200);
      // A gender without places can't join (and is told why).
      expect((await view(sam, event.id)).notForYou).toBe('gender');
      expect((await rsvp(sam, event.id)).statusCode).toBe(403);

      const now = await view(tal, event.id);
      expect(now.pools).toEqual([
        { gender: 'woman', capacity: 2, going: 2, waiting: 1 },
        { gender: 'man', capacity: 2, going: 2, waiting: 1 },
      ]);
      // Each waiting list has its own order.
      expect(now.waitingAhead).toBe(0);
      expect((await view(eli, event.id)).waitingAhead).toBe(0);

      // Maya leaves: the place goes to Tal (the next woman), not Eli.
      await api(ctx, maya, 'DELETE', `/v1/events/${event.id}/rsvp`);
      expect((await view(tal, event.id)).mine).toBe(true);
      expect((await view(eli, event.id)).mine).toBe(false);
      // The staff list shows the same counts, never who.
      const listed = (await asAdmin('GET', '/v1/admin/events')).json().events[0];
      expect(listed.pools[0]).toEqual({ gender: 'woman', capacity: 2, going: 2, waiting: 0 });
      expect(JSON.stringify(listed)).not.toContain('Tal');

      // The export says which group my place is in.
      const zip = await api(ctx, tal, 'GET', '/v1/me/export');
      const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
      expect(data.eventsYouAreGoingTo[0]).toMatchObject({ you: 'going', group: 'woman' });

      // Bad pools.
      const badPools = (pools: object) =>
        asAdmin('POST', '/v1/admin/events', {
          title: 'Bad',
          venueId,
          startsAt: at(60),
          endsAt: at(120),
          pools,
        });
      expect((await badPools([{ gender: 'woman', capacity: 2 }])).statusCode).toBe(400);
      expect(
        (
          await badPools([
            { gender: 'woman', capacity: 2 },
            { gender: 'woman', capacity: 3 },
          ])
        ).statusCode,
      ).toBe(400);
    });

    it('places by gender added later: people going keep their place, in their group', async () => {
      const event = await publish({ capacity: 10 });
      const noa = await member('Noa', 'woman');
      const maya = await member('Maya', 'woman');
      const dan = await member('Dan', 'man');
      for (const m of [noa, maya, dan]) await rsvp(m, event.id);
      const res = await asAdmin('PATCH', `/v1/admin/events/${event.id}`, {
        pools: [
          { gender: 'woman', capacity: 2 },
          { gender: 'man', capacity: 3 },
        ],
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        capacity: 5,
        pools: [
          { gender: 'woman', capacity: 2, going: 2, waiting: 0 },
          { gender: 'man', capacity: 3, going: 1, waiting: 0 },
        ],
      });
      expect((await view(await member('Tal', 'woman'), event.id)).full).toBe(true);
      // Back to one list.
      const back = await asAdmin('PATCH', `/v1/admin/events/${event.id}`, {
        pools: null,
        capacity: 10,
      });
      expect(back.json()).toMatchObject({ capacity: 10, pools: null, going: 3 });
    });

    it('repeats weekly: independent copies with the same audience and places', async () => {
      const event = await publish({
        audience: { genders: [], ageMin: 30, ageMax: 45 },
        pools: [
          { gender: 'woman', capacity: 5 },
          { gender: 'man', capacity: 5 },
        ],
      });
      const noa = await member('Noa', 'woman', 33);
      await rsvp(noa, event.id);
      const res = await asAdmin('POST', `/v1/admin/events/${event.id}/repeat`, { weeks: 3 });
      expect(res.statusCode, res.body).toBe(201);
      const copies = res.json().events;
      expect(copies).toHaveLength(3);
      const week = 7 * 86_400_000;
      copies.forEach((c: { startsAt: string; going: number }, i: number) => {
        expect(Date.parse(c.startsAt)).toBe(Date.parse(event.startsAt) + (i + 1) * week);
        expect(c).toMatchObject({
          going: 0,
          audience: { ageMin: 30, ageMax: 45 },
          pools: [
            { gender: 'woman', capacity: 5 },
            { gender: 'man', capacity: 5 },
          ],
        });
      });
      expect(
        (await asAdmin('POST', `/v1/admin/events/${event.id}/repeat`, { weeks: 13 })).statusCode,
      ).toBe(400);
      expect(
        (await api(ctx, noa, 'POST', `/v1/admin/events/${event.id}/repeat`, { weeks: 1 }))
          .statusCode,
      ).toBe(403);
    });
  },
);
