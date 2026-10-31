// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeClosedChats } from '../../../worker/src/profile-jobs.js';
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

describe.skipIf(!integrationEnabled)('date planner (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  /** Times relative to the test clock, which the API uses for the date window. */
  const inHours = (h: number) => new Date(ctx.clock.value + h * 3_600_000).toISOString();
  const place = {
    name: 'Café Puaa',
    area: 'Jaffa',
    category: 'cafe',
    address: 'Rabbi Yohanan St 8, Tel Aviv-Yafo',
    note: 'Busy until late',
    stepFree: true,
  };

  async function staff(role: 'moderator' | 'admin') {
    const email = `${role}-${(n += 1)}@example.test`;
    const cookie = await signIn(ctx, email);
    await q(`UPDATE "user" SET role = $2 WHERE email = $1`, [email, role]);
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    ctx.clock.value += 30_000;
    const verify = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });
    expect(verify.statusCode).toBe(200);
    return cookie;
  }
  const asStaff = (
    cookie: string,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function addVenue(over: Record<string, unknown> = {}) {
    const res = await asStaff(await staff('admin'), 'POST', '/v1/admin/venues', {
      ...place,
      ...over,
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }
  const propose = (m: Member, venueId: string, over: Record<string, unknown> = {}) =>
    api(ctx, m, 'POST', `/v1/matches/${matchId}/dates`, {
      venueId,
      startsAt: inHours(48),
      note: 'Coffee and a walk by the sea?',
      clientId: `date-${(n += 1)}-xx`,
      ...over,
    });

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
  });

  // ------------------------------------------------------------------ places

  it('only admins manage places; members see only active ones; every change is audited', async () => {
    const mod = await staff('moderator');
    expect((await asStaff(mod, 'POST', '/v1/admin/venues', place)).statusCode).toBe(403);
    expect((await api(ctx, noa, 'POST', '/v1/admin/venues', place)).statusCode).toBe(403);

    const id = await addVenue();
    const hidden = await addVenue({ name: 'Old Bar', category: 'bar' });
    const admin = await staff('admin');
    expect(
      (await asStaff(admin, 'PATCH', `/v1/admin/venues/${hidden}`, { active: false })).json(),
    ).toMatchObject({ active: false });
    expect(
      (await asStaff(mod, 'PATCH', `/v1/admin/venues/${id}`, { active: false })).statusCode,
    ).toBe(403);
    // Moderators can see the list (both places), members only the active one, without internals.
    expect((await asStaff(mod, 'GET', '/v1/admin/venues')).json().venues).toHaveLength(2);
    const seen = (await api(ctx, noa, 'GET', '/v1/venues')).json().venues;
    expect(seen).toEqual([
      {
        id,
        name: 'Café Puaa',
        area: 'Jaffa',
        category: 'cafe',
        address: place.address,
        note: 'Busy until late',
        stepFree: true,
        kosher: false,
        shabbatClosed: false,
      },
    ]);
    const { rows } = await q(
      `SELECT action FROM audit_logs WHERE target_type = 'venue' ORDER BY created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual(['venue.create', 'venue.create', 'venue.update']);
  });

  it('validates places: one line of text, known category, no unknown fields', async () => {
    const admin = await staff('admin');
    for (const bad of [
      { ...place, name: 'Café\nPuaa' },
      { ...place, category: 'home' },
      { ...place, lat: 32.05 },
      { ...place, address: 'x'.repeat(161) },
    ]) {
      expect((await asStaff(admin, 'POST', '/v1/admin/venues', bad)).statusCode).toBe(400);
    }
    expect(
      (await asStaff(admin, 'PATCH', `/v1/admin/venues/${crypto.randomUUID()}`, { active: false }))
        .statusCode,
    ).toBe(404);
  });

  // ------------------------------------------------------------------ proposals

  it('sends a date card both people see, with a copy of the place', async () => {
    const venueId = await addVenue();
    const res = await propose(noa, venueId);
    expect(res.statusCode).toBe(201);
    const card = res.json();
    expect(card).toMatchObject({
      kind: 'date',
      mine: true,
      date: {
        status: 'proposed',
        mine: true,
        venue: { name: 'Café Puaa', area: 'Jaffa', category: 'cafe', stepFree: true },
        note: 'Coffee and a walk by the sea?',
        startsAt: inHours(48),
      },
    });
    expect(card.body).toContain('Café Puaa, Jaffa');
    // Dan sees it in the chat, as not his own, and gets a content-free push.
    const page = (await api(ctx, dan, 'GET', `/v1/matches/${matchId}/messages`)).json();
    expect(page.messages.at(-1)).toMatchObject({
      kind: 'date',
      mine: false,
      date: { status: 'proposed', mine: false },
    });
    expect(ctx.jobs.push).toContainEqual(
      expect.objectContaining({ userId: dan.id, kind: 'message' }),
    );

    // Editing or deactivating the place later doesn't change what was proposed.
    const admin = await staff('admin');
    await asStaff(admin, 'PATCH', `/v1/admin/venues/${venueId}`, {
      name: 'Renamed',
      active: false,
    });
    const again = (await api(ctx, dan, 'GET', `/v1/matches/${matchId}/messages`)).json();
    expect(again.messages.at(-1).date.venue.name).toBe('Café Puaa');
  });

  it('phase 74b: kosher and closed on Shabbat, set by admins, copied into the date', async () => {
    const venueId = await addVenue({ kosher: true, shabbatClosed: true });
    expect((await api(ctx, noa, 'GET', '/v1/venues')).json().venues[0]).toMatchObject({
      kosher: true,
      shabbatClosed: true,
    });
    expect(
      (await api(ctx, noa, 'PATCH', `/v1/admin/venues/${venueId}`, { kosher: false })).statusCode,
    ).toBe(403);
    expect(
      (
        await asStaff(await staff('admin'), 'POST', '/v1/admin/venues', {
          ...place,
          kosher: 'yes',
        })
      ).statusCode,
    ).toBe(400);
    const card = (await propose(noa, venueId)).json();
    expect(card.date.venue).toMatchObject({ kosher: true, shabbatClosed: true });
    // Losing the certificate later doesn't change what was agreed, but new dates see it.
    const admin = await staff('admin');
    await asStaff(admin, 'PATCH', `/v1/admin/venues/${venueId}`, { kosher: false });
    const again = (await api(ctx, dan, 'GET', `/v1/matches/${matchId}/messages`)).json();
    expect(again.messages.at(-1).date.venue).toMatchObject({ kosher: true });
    expect((await api(ctx, noa, 'GET', '/v1/venues')).json().venues[0].kosher).toBe(false);
  });

  it('enforces the rules: participants only, active place, time window, kind note, one open idea', async () => {
    const venueId = await addVenue();
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await propose(eve, venueId)).statusCode).toBe(404);
    expect((await propose(noa, crypto.randomUUID())).statusCode).toBe(404);
    expect((await propose(noa, venueId, { startsAt: inHours(0.25) })).statusCode).toBe(422);
    expect((await propose(noa, venueId, { startsAt: inHours(24 * 61) })).statusCode).toBe(422);
    expect((await propose(noa, venueId, { note: 'you are an idiot' })).statusCode).toBe(422);
    expect((await propose(noa, venueId, { lat: 1 })).statusCode).toBe(400);

    const first = await propose(noa, venueId, { clientId: 'same-client-1' });
    expect(first.statusCode).toBe(201);
    // A retry with the same client id returns the same card; a second open idea is refused.
    const retry = await propose(noa, venueId, { clientId: 'same-client-1' });
    expect(retry.json().id).toBe(first.json().id);
    expect((await propose(dan, venueId)).statusCode).toBe(409);

    const admin = await staff('admin');
    await asStaff(admin, 'PATCH', `/v1/admin/venues/${venueId}`, { active: false });
    await api(ctx, noa, 'POST', `/v1/dates/${first.json().date.id}/cancel`);
    expect((await propose(noa, venueId)).statusCode).toBe(404);
  });

  it('only the other person accepts or declines; the proposer cancels; outsiders get 404', async () => {
    const venueId = await addVenue();
    const id = (await propose(noa, venueId)).json().date.id;
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    for (const action of ['accept', 'decline', 'cancel']) {
      expect((await api(ctx, eve, 'POST', `/v1/dates/${id}/${action}`)).statusCode).toBe(404);
    }
    expect((await api(ctx, noa, 'POST', `/v1/dates/${id}/accept`)).statusCode).toBe(403);
    expect((await api(ctx, dan, 'POST', `/v1/dates/${id}/cancel`)).statusCode).toBe(403);

    const accepted = await api(ctx, dan, 'POST', `/v1/dates/${id}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().date).toMatchObject({ status: 'accepted', mine: false });
    expect((await api(ctx, dan, 'POST', `/v1/dates/${id}/decline`)).statusCode).toBe(409);
    // Noa sees the change too, and a new idea is possible once nothing is open.
    const page = (await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`)).json();
    expect(page.messages.at(-1).date.status).toBe('accepted');

    // Either person can cancel an accepted date before it starts, but not after.
    expect((await api(ctx, dan, 'POST', `/v1/dates/${id}/cancel`)).json().date.status).toBe(
      'cancelled',
    );
    const second = (await propose(noa, venueId, { startsAt: inHours(2) })).json().date.id;
    await api(ctx, dan, 'POST', `/v1/dates/${second}/accept`);
    ctx.clock.value += 3 * 3_600_000;
    expect((await api(ctx, noa, 'POST', `/v1/dates/${second}/cancel`)).statusCode).toBe(409);
  });

  it("can't accept an idea whose time has passed, or one in a chat that was closed", async () => {
    const venueId = await addVenue();
    const late = (await propose(noa, venueId, { startsAt: inHours(1) })).json().date.id;
    ctx.clock.value += 2 * 3_600_000;
    expect((await api(ctx, dan, 'POST', `/v1/dates/${late}/accept`)).statusCode).toBe(409);
    expect((await api(ctx, dan, 'POST', `/v1/dates/${late}/decline`)).statusCode).toBe(200);

    const open = (await propose(noa, venueId)).json().date.id;
    await api(ctx, dan, 'DELETE', `/v1/matches/${matchId}`);
    expect((await api(ctx, dan, 'POST', `/v1/dates/${open}/accept`)).statusCode).toBe(404);
  });

  it('reports include the card as evidence; export and purge cover date ideas', async () => {
    const venueId = await addVenue();
    await propose(noa, venueId);
    const id = (await api(ctx, dan, 'GET', `/v1/matches/${matchId}/messages`))
      .json()
      .messages.at(-1).id;
    const report = await api(ctx, dan, 'POST', '/v1/reports', {
      targetId: noa.id,
      category: 'harassment',
      messageIds: [id],
    });
    expect(report.statusCode).toBe(201);
    const { rows: evidence } = await q('SELECT kind, body FROM report_evidence');
    expect(evidence).toEqual([{ kind: 'text', body: expect.stringContaining('Café Puaa, Jaffa') }]);

    // Export: Noa's own note is included; Dan's export has the idea but not Noa's note.
    const unpack = async (m: Member) => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: m.cookie },
      });
      return JSON.parse(strFromU8(unzipSync(new Uint8Array(res.rawPayload))['data.json']!));
    };
    expect((await unpack(noa)).dateIdeas).toEqual([
      expect.objectContaining({
        place: 'Café Puaa',
        proposedByYou: true,
        note: expect.any(String),
      }),
    ]);
    expect((await unpack(dan)).dateIdeas).toEqual([
      expect.objectContaining({ place: 'Café Puaa', proposedByYou: false, note: null }),
    ]);

    // 30 days after an unmatch, the chat and its date ideas are gone.
    await q(`UPDATE matches SET unmatched_at = now() - interval '31 days'`);
    await purgeClosedChats(ctx.services.dbHandle.db, ctx.services.storage);
    expect((await q('SELECT count(*)::int AS n FROM date_plans')).rows[0].n).toBe(0);
  });
});
