import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processCheckins } from '../../../worker/src/checkin-jobs.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('safety check-ins (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let sent: { to: string; subject: string; text: string; html: string }[];
  let reminded: string[];
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const input = (over: Record<string, unknown> = {}) => ({
    matchId,
    place: 'Café <b>Puaa</b>, Jaffa',
    startsAt: minutes(0),
    checkAt: minutes(120),
    contactName: 'Dana',
    contactEmail: 'dana@example.org',
    note: 'Red bike',
    locale: 'en',
    timeZone: 'Asia/Jerusalem',
    ...over,
  });
  const run = (now = new Date()) =>
    processCheckins({
      db: ctx.services.dbHandle.db,
      instanceName: async () => 'Ahava',
      sendMail: async (m) => void sent.push(m),
      remind: async (userId) => void reminded.push(userId),
      now: () => now,
    });

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    sent = [];
    reminded = [];
    ctx.mail.length = 0;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;
  });

  it('creates one active check-in with the match name, never showing the full contact address', async () => {
    const res = await api(ctx, noa, 'POST', '/v1/me/checkins', input());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'active',
      matchName: 'Dan',
      contactEmailMasked: 'd***@example.org',
    });
    expect(JSON.stringify(res.json())).not.toContain('dana@example.org');
    expect((await api(ctx, noa, 'POST', '/v1/me/checkins', input())).statusCode).toBe(409);
    expect((await api(ctx, noa, 'GET', '/v1/me/checkins/active')).json().checkin.id).toBe(
      res.json().id,
    );
    // Nothing is emailed to the contact when it is created.
    expect(ctx.mail.filter((m) => m.to === 'dana@example.org')).toHaveLength(0);
  });

  it('only the owner can see or act on a check-in, and only with their own match', async () => {
    const id = (await api(ctx, noa, 'POST', '/v1/me/checkins', input())).json().id;
    expect((await api(ctx, dan, 'POST', `/v1/me/checkins/${id}/sos`)).statusCode).toBe(404);
    expect((await api(ctx, dan, 'POST', `/v1/me/checkins/${id}/ok`)).statusCode).toBe(404);
    expect((await api(ctx, dan, 'DELETE', `/v1/me/checkins/${id}`)).statusCode).toBe(404);
    expect((await api(ctx, dan, 'GET', '/v1/me/checkins/active')).json().checkin).toBeNull();
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await api(ctx, eve, 'POST', '/v1/me/checkins', input())).statusCode).toBe(404);
  });

  it('validates the time window and limits check-ins per day', async () => {
    expect(
      (await api(ctx, noa, 'POST', '/v1/me/checkins', input({ checkAt: minutes(5) }))).statusCode,
    ).toBe(400);
    for (let i = 0; i < 5; i += 1) {
      const id = (await api(ctx, noa, 'POST', '/v1/me/checkins', input())).json().id;
      await api(ctx, noa, 'POST', `/v1/me/checkins/${id}/ok`);
    }
    expect((await api(ctx, noa, 'POST', '/v1/me/checkins', input())).statusCode).toBe(429);
  });

  it('reminds at the check-in time and alerts the contact 15 minutes later, once', async () => {
    const id = (await api(ctx, noa, 'POST', '/v1/me/checkins', input())).json().id;
    const at = (m: number) => new Date(Date.now() + m * 60_000);
    expect(await run(at(60))).toMatchObject({ reminded: 0, alerted: 0 });
    expect(await run(at(121))).toMatchObject({ reminded: 1, alerted: 0 });
    expect(reminded).toEqual([noa.id]);
    expect(sent).toHaveLength(0);
    expect(await run(at(136))).toMatchObject({ reminded: 0, alerted: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('dana@example.org');
    expect(sent[0]!.subject).toBe('Ahava: Noa did not check in after a date');
    expect(sent[0]!.text).toContain('Meeting: Dan');
    expect(sent[0]!.html).not.toContain('<b>');
    expect(await run(at(150))).toMatchObject({ alerted: 0 }); // never twice
    expect((await api(ctx, noa, 'GET', '/v1/me/checkins/active')).json().checkin).toMatchObject({
      id,
      status: 'alerted',
    });
  });

  it('"I\'m OK" stops the alert', async () => {
    const id = (await api(ctx, noa, 'POST', '/v1/me/checkins', input())).json().id;
    expect((await api(ctx, noa, 'POST', `/v1/me/checkins/${id}/ok`)).statusCode).toBe(200);
    expect(await run(new Date(Date.now() + 200 * 60_000))).toMatchObject({ alerted: 0 });
    expect(sent).toHaveLength(0);
    expect((await api(ctx, noa, 'GET', '/v1/me/checkins/active')).json().checkin).toBeNull();
  });

  it('SOS emails at once, at most 3 times, and still works while suspended', async () => {
    const id = (await api(ctx, noa, 'POST', '/v1/me/checkins', input())).json().id;
    await q(`UPDATE "user" SET status = 'suspended' WHERE id = $1`, [noa.id]);
    const res = await api(ctx, noa, 'POST', `/v1/me/checkins/${id}/sos`);
    expect(res.statusCode).toBe(200);
    expect(res.json().sosCount).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    const sos = ctx.mail.filter((m) => m.to === 'dana@example.org');
    expect(sos).toHaveLength(1);
    expect(sos[0]!.subject).toBe('URGENT: Noa asked for help (SOS)');
    await api(ctx, noa, 'POST', `/v1/me/checkins/${id}/sos`);
    await api(ctx, noa, 'POST', `/v1/me/checkins/${id}/sos`);
    expect((await api(ctx, noa, 'POST', `/v1/me/checkins/${id}/sos`)).statusCode).toBe(429);
    // A suspended account can't start a new one.
    await api(ctx, noa, 'POST', `/v1/me/checkins/${id}/ok`);
    expect((await api(ctx, noa, 'POST', '/v1/me/checkins', input())).statusCode).toBe(403);
  });

  it('is part of "Download my data"', async () => {
    await api(ctx, noa, 'POST', '/v1/me/checkins', input());
    const { unzipSync, strFromU8 } = await import('fflate');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/export',
      headers: { cookie: noa.cookie },
    });
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(res.rawPayload))['data.json']!));
    expect(data.safetyCheckins).toEqual([
      expect.objectContaining({ place: 'Café <b>Puaa</b>, Jaffa', contactName: 'Dana' }),
    ]);
  });

  it('cancelling deletes it; ended ones are deleted after 7 days', async () => {
    const id = (await api(ctx, noa, 'POST', '/v1/me/checkins', input())).json().id;
    expect((await api(ctx, noa, 'DELETE', `/v1/me/checkins/${id}`)).statusCode).toBe(200);
    expect((await q('SELECT 1 FROM checkins WHERE id = $1', [id])).rowCount).toBe(0);
    const other = (await api(ctx, noa, 'POST', '/v1/me/checkins', input())).json().id;
    await api(ctx, noa, 'POST', `/v1/me/checkins/${other}/ok`);
    await q(`UPDATE checkins SET ended_at = now() - interval '8 days' WHERE id = $1`, [other]);
    expect((await run()).deleted).toBe(1);
  });
});

describe.skipIf(!integrationEnabled)('close kindly (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
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
  const message = 'Thank you for chatting, I don’t feel a match. Wishing you the best!';

  it('unmatches and shows the other person a card with the message', async () => {
    const res = await api(ctx, noa, 'POST', `/v1/matches/${matchId}/close`, { message });
    expect(res.statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`)).statusCode).toBe(404);
    const cards = (await api(ctx, dan, 'GET', '/v1/matches/closed')).json().closed;
    expect(cards).toEqual([expect.objectContaining({ matchId, name: 'Noa', message })]);
    // The person who closed doesn't get a card.
    expect((await api(ctx, noa, 'GET', '/v1/matches/closed')).json().closed).toEqual([]);
    // Dismissing hides it; only the receiver can dismiss.
    expect((await api(ctx, noa, 'POST', `/v1/matches/${matchId}/closed/dismiss`)).statusCode).toBe(
      404,
    );
    expect((await api(ctx, dan, 'POST', `/v1/matches/${matchId}/closed/dismiss`)).statusCode).toBe(
      200,
    );
    expect((await api(ctx, dan, 'GET', '/v1/matches/closed')).json().closed).toEqual([]);
  });

  it('refuses hurtful words, outsiders, and shows nothing after a block or a week', async () => {
    expect(
      (await api(ctx, noa, 'POST', `/v1/matches/${matchId}/close`, { message: 'you are an idiot' }))
        .statusCode,
    ).toBe(422);
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect(
      (await api(ctx, eve, 'POST', `/v1/matches/${matchId}/close`, { message })).statusCode,
    ).toBe(404);
    await api(ctx, noa, 'POST', `/v1/matches/${matchId}/close`, { message });
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
    expect((await api(ctx, dan, 'GET', '/v1/matches/closed')).json().closed).toEqual([]);
    await ctx.services.dbHandle.pool.query('DELETE FROM blocks');
    await ctx.services.dbHandle.pool.query(
      `UPDATE matches SET unmatched_at = now() - interval '8 days'`,
    );
    expect((await api(ctx, dan, 'GET', '/v1/matches/closed')).json().closed).toEqual([]);
  });
});
