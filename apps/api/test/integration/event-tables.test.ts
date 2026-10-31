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
  'tables and the place revealed later, phase 71d (integration)',
  () => {
    let ctx: TestContext;
    let admin: string;
    let venueId: string;
    let n = 0;
    const HOUR = 3_600_000;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    const at = (hours: number) => new Date(ctx.clock.value + hours * HOUR).toISOString();
    const calm = { pace: 'calm', talk: 'deep', drinks: 'no_alcohol' };
    const lively = { pace: 'lively', talk: 'light', drinks: 'alcohol' };

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
    const member = (name: string, gender: 'woman' | 'man') =>
      createMember(ctx, { name, gender, interestedIn: gender === 'woman' ? ['man'] : ['woman'] });
    const view = async (m: Member, id: string) =>
      (await api(ctx, m, 'GET', `/v1/events/${id}`)).json();
    const table = async (m: Member, id: string) => api(ctx, m, 'GET', `/v1/events/${id}/table`);
    const join = (m: Member, id: string, answers: object) =>
      api(ctx, m, 'PUT', `/v1/events/${id}/table`, answers);

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
          name: 'The Secret Garden',
          area: 'Tel Aviv',
          category: 'restaurant',
          address: 'Hidden st. 7',
          note: 'Ring the bell twice',
        })
      ).json().id;
    });

    it('the place is hidden until the reveal; tables are set then, mine only', async () => {
      const res = await asAdmin('POST', '/v1/admin/events', {
        title: 'Dinner with strangers',
        venueId,
        startsAt: at(48),
        endsAt: at(51),
        revealHours: 24,
        tableSize: 4,
      });
      expect(res.statusCode, res.body).toBe(201);
      const id = res.json().id as string;
      expect(res.json()).toMatchObject({ tableSize: 4, tables: null });
      expect(res.json().venue.name).toBe('The Secret Garden'); // staff always see it

      const women = [
        await member('Noa', 'woman'),
        await member('Maya', 'woman'),
        await member('Tal', 'woman'),
      ];
      const men = [
        await member('Dan', 'man'),
        await member('Gil', 'man'),
        await member('Eli', 'man'),
      ];
      const late = await member('Lior', 'man');
      const outsider = await member('Ron', 'man');
      for (const m of [...women, ...men, late]) await api(ctx, m, 'POST', `/v1/events/${id}/rsvp`);

      // Before the reveal: the area only.
      const before = await view(women[0]!, id);
      expect(before).toMatchObject({ placeHidden: true, tableSize: 4 });
      expect(before.venue).toMatchObject({ name: '', area: 'Tel Aviv', address: '', note: null });
      expect(Date.parse(before.placeRevealAt)).toBe(Date.parse(at(24)));

      // Joining a table: only people going; answers validated.
      expect((await table(outsider, id)).statusCode).toBe(404);
      expect((await join(outsider, id, calm)).statusCode).toBe(404);
      expect((await join(women[0]!, id, { pace: 'wild' })).statusCode).toBe(400);
      for (const [i, m] of [...women, ...men].entries()) {
        expect((await join(m, id, i % 3 === 0 ? lively : calm)).statusCode).toBe(200);
      }
      const waiting = (await table(women[0]!, id)).json();
      expect(waiting).toMatchObject({ joined: true, set: false, tableNo: null, mates: [] });
      // Changing answers before the tables are set is fine.
      expect((await join(women[0]!, id, calm)).json().answers).toEqual(calm);

      // The reveal: the place appears, the tables are set once.
      ctx.clock.value += 25 * HOUR;
      const after = await view(women[0]!, id);
      expect(after.placeHidden).toBe(false);
      expect(after.venue).toMatchObject({ name: 'The Secret Garden', address: 'Hidden st. 7' });
      const mine = (await table(women[0]!, id)).json();
      expect(mine.set).toBe(true);
      expect(mine.tableNo).toEqual(expect.any(Number));
      expect(mine.mates).toHaveLength(2); // 6 people, tables of 3 (two tables of about 4)
      // Each table has women and men; I never see the other table.
      const tables = new Map<number, string[]>();
      for (const m of [...women, ...men]) {
        const t = (await table(m, id)).json();
        tables.set(t.tableNo, [...(tables.get(t.tableNo) ?? []), m.name]);
      }
      expect([...tables.values()].map((t) => t.length).sort()).toEqual([3, 3]);
      for (const names of tables.values()) {
        expect(names.some((x) => ['Noa', 'Maya', 'Tal'].includes(x))).toBe(true);
        expect(names.some((x) => ['Dan', 'Gil', 'Eli'].includes(x))).toBe(true);
      }
      const myTable = tables.get(mine.tableNo)!;
      expect(mine.mates.sort()).toEqual(myTable.filter((x) => x !== 'Noa').sort());

      // Someone joining late goes to the smallest table (any, here both have 3).
      const lateTable = (await join(late, id, calm)).json();
      expect(lateTable).toMatchObject({ set: true, tableNo: expect.any(Number) });
      expect(lateTable.mates).toHaveLength(3);
      // Staff see counts only (signing in again: a day has passed since the MFA).
      admin = await staff();
      const listed = (await asAdmin('GET', '/v1/admin/events')).json().events[0];
      expect([...listed.tables].sort()).toEqual([3, 4]);
      expect(JSON.stringify(listed)).not.toContain('Noa');

      // Leaving the event leaves the table.
      const mate = [...women, ...men].find((m) => m.name === mine.mates[0])!;
      await api(ctx, mate, 'DELETE', `/v1/events/${id}/rsvp`);
      expect((await table(women[0]!, id)).json().mates).not.toContain(mate.name);

      // The export has my answers and my table.
      const zip = await api(ctx, women[0]!, 'GET', '/v1/me/export');
      const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
      expect(data.eventsYouAreGoingTo[0]).toMatchObject({
        tableAnswers: calm,
        table: mine.tableNo,
      });
    });

    it('without a reveal, the place shows and the tables are set at the start', async () => {
      const res = await asAdmin('POST', '/v1/admin/events', {
        title: 'Picnic',
        venueId,
        startsAt: at(2),
        endsAt: at(4),
        tableSize: 6,
      });
      const id = res.json().id as string;
      const noa = await member('Noa', 'woman');
      await api(ctx, noa, 'POST', `/v1/events/${id}/rsvp`);
      expect(await view(noa, id)).toMatchObject({ placeHidden: false, placeRevealAt: null });
      const joined = (await join(noa, id, calm)).json();
      expect(Date.parse(joined.setAt)).toBe(Date.parse(at(2)));
      expect(joined.set).toBe(false);
      ctx.clock.value += 2 * HOUR + 60_000;
      expect((await table(noa, id)).json()).toMatchObject({ set: true, tableNo: 1, mates: [] });
      // Leaving the table: answers gone.
      expect((await api(ctx, noa, 'DELETE', `/v1/events/${id}/table`)).json()).toMatchObject({
        joined: false,
        answers: null,
        tableNo: null,
      });
      // Events without tables have none.
      const plain = (
        await asAdmin('POST', '/v1/admin/events', {
          title: 'Walk',
          venueId,
          startsAt: at(5),
          endsAt: at(6),
        })
      ).json().id;
      await api(ctx, noa, 'POST', `/v1/events/${plain}/rsvp`);
      expect((await table(noa, plain)).statusCode).toBe(404);
      // Validation.
      const bad = (over: object) =>
        asAdmin('POST', '/v1/admin/events', {
          title: 'Bad',
          venueId,
          startsAt: at(5),
          endsAt: at(6),
          ...over,
        });
      expect((await bad({ tableSize: 3 })).statusCode).toBe(400);
      expect((await bad({ tableSize: 11 })).statusCode).toBe(400);
      expect((await bad({ revealHours: 73 })).statusCode).toBe(400);
    });
  },
);
