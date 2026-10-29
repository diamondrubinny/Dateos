// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { CHECKIN_EXTENSIONS } from '@nexaheart/shared';
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

describe.skipIf(!integrationEnabled)('running late: extending a check-in (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let sent: { to: string }[];
  let reminded: string[];
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const create = async (over: Record<string, unknown> = {}) =>
    (
      await api(ctx, noa, 'POST', '/v1/me/checkins', {
        place: 'Café Puaa, Jaffa',
        startsAt: minutes(0),
        checkAt: minutes(120),
        contactName: 'Dana',
        contactEmail: 'dana@example.org',
        locale: 'en',
        timeZone: 'Asia/Jerusalem',
        ...over,
      })
    ).json().id as string;
  const extend = (id: string, by: number, who: Member = noa) =>
    api(ctx, who, 'POST', `/v1/me/checkins/${id}/extend`, { minutes: by });
  const run = () =>
    processCheckins({
      db: ctx.services.dbHandle.db,
      instanceName: async () => 'Ahava',
      sendMail: async (m) => void sent.push(m),
      remind: async (userId) => void reminded.push(userId),
    });

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    sent = [];
    reminded = [];
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  it('moves the check-in time later, from the time already set', async () => {
    const id = await create();
    const before = Date.parse(
      (await api(ctx, noa, 'GET', '/v1/me/checkins/active')).json().checkin.checkAt,
    );
    const res = await extend(id, 30);
    expect(res.statusCode).toBe(200);
    expect(Date.parse(res.json().checkAt) - before).toBe(30 * 60_000);
    expect(res.json().extensionsLeft).toBe(CHECKIN_EXTENSIONS - 1);
  });

  it('after the reminder, counts from now and reminds again at the new time, without alerting', async () => {
    const id = await create();
    await q(`UPDATE checkins SET check_at = now() - interval '5 minutes' WHERE id = $1`, [id]);
    await run();
    expect(reminded).toEqual([noa.id]);
    const res = await extend(id, 60);
    expect(res.statusCode).toBe(200);
    const due = Date.parse(res.json().checkAt) - Date.now();
    expect(due).toBeGreaterThan(59 * 60_000);
    expect(due).toBeLessThanOrEqual(60 * 60_000);
    // Past the old deadline the contact isn't emailed; at the new time she's reminded again.
    await run();
    expect(sent).toHaveLength(0);
    const { rows } = await q('SELECT reminded_at FROM checkins WHERE id = $1', [id]);
    expect(rows[0].reminded_at).toBeNull();
  });

  it(`at most ${CHECKIN_EXTENSIONS} times`, async () => {
    const id = await create();
    for (let i = 0; i < CHECKIN_EXTENSIONS; i++)
      expect((await extend(id, 30)).statusCode).toBe(200);
    const res = await extend(id, 30);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('never past 12 hours from the start', async () => {
    const id = await create({ checkAt: minutes(11 * 60 + 15) });
    const tooLong = await extend(id, 60);
    expect(tooLong.statusCode).toBe(422);
    // Nothing changed, and a shorter extension still fits.
    expect((await extend(id, 30)).statusCode).toBe(200);
  });

  it('once the contact was emailed, it can only be ended', async () => {
    const id = await create();
    await q(`UPDATE checkins SET check_at = now() - interval '30 minutes' WHERE id = $1`, [id]);
    await run();
    expect(sent.map((m) => m.to)).toEqual(['dana@example.org']);
    const res = await extend(id, 30);
    expect(res.statusCode).toBe(409);
    expect((await api(ctx, noa, 'POST', `/v1/me/checkins/${id}/ok`)).statusCode).toBe(200);
  });

  it('only the owner, and only the offered lengths', async () => {
    const id = await create();
    expect((await extend(id, 30, dan)).statusCode).toBe(404);
    expect((await extend(id, 45)).statusCode).toBe(400);
    expect((await extend(id, -30)).statusCode).toBe(400);
  });
});
