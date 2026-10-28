// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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

describe.skipIf(!integrationEnabled)('"your report was reviewed" (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
  });

  async function moderator() {
    const email = `moderator-outcome-${(n += 1)}@example.test`;
    const cookie = await signIn(ctx, email);
    await q(`UPDATE "user" SET role = 'moderator' WHERE email = $1`, [email]);
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
  const report = async () =>
    (
      await api(ctx, noa, 'POST', '/v1/reports', {
        targetId: dan.id,
        category: 'harassment',
        details: 'Rude messages',
        block: false,
      })
    ).json().reportId as string;
  const resolve = async (reportId: string, action: 'dismiss' | 'warn' | 'suspend') =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/resolve`,
      headers: { cookie: await moderator() },
      payload: { action, reason: 'internal note: never shown to members' },
    });
  const notices = async (m: Member) =>
    (await api(ctx, m, 'GET', '/v1/me')).json().notices as Record<string, unknown>[];

  it('nothing while the report is open', async () => {
    await report();
    expect(await notices(noa)).toEqual([]);
  });

  it('after action: "we took action", never which one or the internal note', async () => {
    const id = await report();
    expect((await resolve(id, 'suspend')).statusCode).toBe(200);
    const list = await notices(noa);
    expect(list).toEqual([
      expect.objectContaining({
        id,
        kind: 'report_reviewed',
        category: 'harassment',
        outcome: 'actioned',
      }),
    ]);
    const text = JSON.stringify(list);
    for (const leak of ['suspend', 'internal note', dan.id, 'Dan'])
      expect(text).not.toContain(leak);
  });

  it('after a dismissal: "no rule broken"; OK dismisses it for good', async () => {
    const id = await report();
    await resolve(id, 'dismiss');
    expect((await notices(noa))[0]).toMatchObject({ outcome: 'dismissed' });
    expect((await api(ctx, noa, 'POST', `/v1/me/notices/${id}/ack`)).statusCode).toBe(200);
    expect(await notices(noa)).toEqual([]);
  });

  it('only the reporter sees or dismisses it; the reported person gets a warning, not this', async () => {
    const id = await report();
    await resolve(id, 'warn');
    expect((await notices(dan)).map((x) => x.kind)).toEqual(['warning']);
    expect((await api(ctx, dan, 'POST', `/v1/me/notices/${id}/ack`)).statusCode).toBe(404);
    expect((await notices(noa)).map((x) => x.kind)).toEqual(['report_reviewed']);
  });

  it('decisions older than 30 days are not shown', async () => {
    const id = await report();
    await resolve(id, 'dismiss');
    await q(`UPDATE reports SET resolved_at = now() - interval '31 days' WHERE id = $1`, [id]);
    expect(await notices(noa)).toEqual([]);
  });
});
