// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processEvents } from '../../../worker/src/event-jobs.js';
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
  '"Meet again" and missed events, phase 71a (integration)',
  () => {
    let ctx: TestContext;
    let noa: Member;
    let maya: Member;
    let dan: Member;
    let gil: Member;
    let admin: string;
    let venueId: string;
    let n = 0;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    const at = (minutes: number) => new Date(ctx.clock.value + minutes * 60_000).toISOString();
    const HOUR = 3_600_000;

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
    async function publish(over: Record<string, unknown> = {}) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/admin/events',
        headers: { cookie: admin },
        payload: { title: 'Evening meetup', venueId, startsAt: at(60), endsAt: at(120), ...over },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().id as string;
    }
    const going = async (eventId: string, ...members: Member[]) => {
      for (const m of members) {
        const res = await api(ctx, m, 'POST', `/v1/events/${eventId}/rsvp`);
        expect(res.statusCode, res.body).toBe(200);
      }
    };
    /** Checked in at the venue (the code itself is tested in live-events). */
    const checkedIn = (eventId: string, ...members: Member[]) =>
      q(
        `UPDATE event_rsvps SET checked_in_at = $3 WHERE event_id = $1 AND user_id = ANY($2::text[])`,
        [eventId, members.map((m) => m.id), new Date(ctx.clock.value)],
      );
    const meet = (m: Member, id: string) => api(ctx, m, 'GET', `/v1/events/${id}/meet-again`);
    const names = async (m: Member, id: string) =>
      (await meet(m, id)).json().people.map((p: { displayName: string }) => p.displayName);
    const choose = (m: Member, id: string, other: Member, yes = true) =>
      api(ctx, m, 'PUT', `/v1/events/${id}/meet-again/${other.id}`, { yes });

    beforeAll(async () => {
      ctx = await setupIntegration();
    });
    afterAll(async () => teardown(ctx));
    beforeEach(async () => {
      await resetState(ctx);
      ctx.clock.value = Date.now();
      noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      maya = await createMember(ctx, { name: 'Maya', gender: 'woman', interestedIn: ['man'] });
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      gil = await createMember(ctx, { name: 'Gil', gender: 'man', interestedIn: ['woman'] });
      admin = await staff();
      venueId = (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/admin/venues',
          headers: { cookie: admin },
          payload: {
            name: 'Cafe Nord',
            area: 'Tel Aviv',
            category: 'cafe',
            address: 'Dizengoff 1',
          },
        })
      ).json().id;
    });

    it('Meet again: only who checked in, after the event, for 3 days; only a mutual choice matches', async () => {
      const id = await publish();
      await going(id, noa, maya, dan, gil);
      ctx.clock.value += 70 * 60_000;
      await checkedIn(id, noa, dan, gil);
      // Not before the end.
      expect((await meet(noa, id)).statusCode).toBe(409);
      expect((await api(ctx, noa, 'GET', `/v1/events/${id}`)).json().meetAgainUntil).toBeNull();

      ctx.clock.value += HOUR; // the event ended
      // Maya was going but didn't check in.
      expect((await meet(maya, id)).statusCode).toBe(404);
      expect((await api(ctx, maya, 'POST', `/v1/events/${id}/meet-again`)).statusCode).toBe(404);
      // Still in Noa's events while it's open; not in Maya's.
      const list = (m: Member) =>
        api(ctx, m, 'GET', '/v1/events').then((r) => r.json().events as { id: string }[]);
      const mine = (await list(noa)).find((e) => e.id === id) as unknown as {
        meetAgainUntil: string;
      };
      expect(Date.parse(mine.meetAgainUntil)).toBe(Date.parse(at(-10)) + 72 * HOUR);
      expect((await list(maya)).some((e) => e.id === id)).toBe(false);

      // Nobody is listed until they join; joining lists me only to others who joined.
      expect((await meet(noa, id)).json()).toMatchObject({ joined: false, people: [] });
      expect((await api(ctx, noa, 'POST', `/v1/events/${id}/meet-again`)).json().people).toEqual(
        [],
      );
      await api(ctx, dan, 'POST', `/v1/events/${id}/meet-again`);
      await api(ctx, gil, 'POST', `/v1/events/${id}/meet-again`);
      expect(await names(noa, id)).toEqual(['Dan', 'Gil']);
      // Only people they could see anyway: Dan and Gil look for women, not each other.
      expect(await names(dan, id)).toEqual(['Noa']);
      expect((await choose(dan, id, gil)).statusCode).toBe(404);
      expect((await choose(dan, id, maya)).statusCode).toBe(404);

      // A one-sided choice shows nothing to the other.
      const chosen = (await choose(noa, id, dan)).json();
      expect(chosen.people.find((p: { displayName: string }) => p.displayName === 'Dan')).toEqual(
        expect.objectContaining({ picked: true, matchId: null }),
      );
      expect((await meet(dan, id)).json().people[0]).toMatchObject({
        picked: false,
        matchId: null,
      });
      expect((await api(ctx, dan, 'GET', '/v1/matches')).json().matches).toHaveLength(0);
      // Both: a match (once), for both of them.
      const both = (await choose(dan, id, noa)).json();
      const matchId = both.people[0].matchId;
      expect(matchId).toEqual(expect.any(String));
      expect((await choose(dan, id, noa)).json().people[0].matchId).toBe(matchId);
      expect(
        (await meet(noa, id))
          .json()
          .people.find((p: { displayName: string }) => p.displayName === 'Dan').matchId,
      ).toBe(matchId);
      const { rows } = await q(`SELECT count(*)::int AS c FROM matches`);
      expect(rows[0].c).toBe(1);

      // Taking a choice back; a block removes them from the list.
      await choose(noa, id, gil);
      expect((await choose(noa, id, gil, false)).json().people[1]).toMatchObject({ picked: false });
      expect((await api(ctx, gil, 'POST', '/v1/blocks', { userId: noa.id })).statusCode).toBe(200);
      expect(await names(noa, id)).toEqual(['Dan']);
      expect((await choose(noa, id, gil)).statusCode).toBe(404);

      // The export says whom I chose, never who chose me.
      const zip = await api(ctx, dan, 'GET', '/v1/me/export');
      const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
      expect(data.meetAgainChoices).toEqual([expect.objectContaining({ chose: 'Noa' })]);
      expect(data.eventsYouAreGoingTo[0].joinedMeetAgainAt).toBeTruthy();

      // Closed after 3 days; the choices go with the RSVPs.
      ctx.clock.value += 72 * HOUR;
      expect((await meet(noa, id)).statusCode).toBe(409);
      await processEvents({
        db: ctx.services.dbHandle.db,
        remind: async () => undefined,
        now: () => new Date(ctx.clock.value + 31 * 24 * HOUR),
      });
      const left = await q(`SELECT count(*)::int AS c FROM event_picks`);
      expect(left.rows[0].c).toBe(0);
    });

    it('missed events: counted only where check-in was used; two pause new places; one excuse a month', async () => {
      const misses = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me/event-misses')).json();
      const a = await publish({ title: 'Event A', startsAt: at(60), endsAt: at(120) });
      const b = await publish({ title: 'Event B', startsAt: at(180), endsAt: at(240) });
      const c = await publish({
        title: 'Event C',
        startsAt: at(300),
        endsAt: at(360),
        capacity: 2,
      });
      const d = await publish({ title: 'D (no check-in used)', startsAt: at(60), endsAt: at(120) });
      const e = await publish({ title: 'E (left in time)', startsAt: at(60), endsAt: at(120) });
      await going(a, dan, noa);
      await going(b, dan, noa);
      await going(d, dan);
      await going(e, dan, noa);
      expect((await api(ctx, dan, 'DELETE', `/v1/events/${e}/rsvp`)).statusCode).toBe(200);
      await going(c, noa, maya);
      expect((await api(ctx, dan, 'POST', `/v1/events/${c}/waitlist`)).statusCode).toBe(200);
      await checkedIn(a, noa);
      await checkedIn(b, noa);
      await checkedIn(e, noa);
      // Noa leaves C an hour before: Dan gets the place too late for it to count.
      ctx.clock.value += 240 * 60_000;
      expect((await api(ctx, noa, 'DELETE', `/v1/events/${c}/rsvp`)).statusCode).toBe(200);
      await checkedIn(c, maya);

      ctx.clock.value += 130 * 60_000; // all ended
      // Leaving after the end is refused: a miss can't be erased.
      expect((await api(ctx, dan, 'DELETE', `/v1/events/${a}/rsvp`)).statusCode).toBe(409);
      const mine = await misses(dan);
      expect(mine.noShows.map((x: { title: string }) => x.title)).toEqual(['Event B', 'Event A']);
      const endB = Date.parse(at(-370 + 240));
      expect(Date.parse(mine.pausedUntil)).toBe(endB + 14 * 24 * HOUR);
      expect(mine.canExcuse).toBe(true);
      expect(await misses(noa)).toEqual({ noShows: [], pausedUntil: null, canExcuse: false });

      // Paused: no new places, no waiting lists; said plainly.
      const f = await publish({ title: 'Event F', capacity: 2 });
      const refused = await api(ctx, dan, 'POST', `/v1/events/${f}/rsvp`);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.message).toContain('paused');
      await going(f, maya, gil);
      expect((await api(ctx, dan, 'POST', `/v1/events/${f}/waitlist`)).statusCode).toBe(409);

      // One excuse lifts it; a second in the same month is refused.
      const excused = (await api(ctx, dan, 'POST', `/v1/me/event-misses/${b}/excuse`)).json();
      expect(excused).toMatchObject({ pausedUntil: null, canExcuse: false });
      expect(excused.noShows[0]).toMatchObject({ title: 'Event B', excused: true });
      expect((await api(ctx, dan, 'POST', `/v1/me/event-misses/${a}/excuse`)).statusCode).toBe(409);
      expect((await api(ctx, dan, 'POST', `/v1/me/event-misses/${d}/excuse`)).statusCode).toBe(404);
      expect((await api(ctx, noa, 'POST', `/v1/me/event-misses/${a}/excuse`)).statusCode).toBe(404);
      expect((await api(ctx, dan, 'POST', `/v1/events/${f}/waitlist`)).statusCode).toBe(200);

      // Older than 30 days: gone.
      ctx.clock.value += 31 * 24 * HOUR;
      expect((await misses(dan)).noShows).toEqual([]);
    });
  },
);
