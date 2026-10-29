// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { BACKUP_STALE_HOURS } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { createMember } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('dashboard system page (integration)', () => {
  let ctx: TestContext;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);

  async function staff(role: 'moderator' | 'admin') {
    const email = `system-${role}-${(n += 1)}@example.test`;
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
  const system = (cookie: string) =>
    ctx.app.inject({ method: 'GET', url: '/v1/admin/system', headers: { cookie } });

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    await q('DELETE FROM maintenance_runs');
  });

  it('shows the same checks as /ready, and that no backup was ever recorded', async () => {
    const res = await system(await staff('admin'));
    expect(res.statusCode).toBe(200);
    const ready = (await ctx.app.inject({ method: 'GET', url: '/ready' })).json();
    expect(res.json()).toEqual({
      status: ready.status,
      checks: ready.checks,
      backup: { lastAt: null, bytes: null, stale: true },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('the latest backup, and whether it is too old', async () => {
    const admin = await staff('admin');
    await q(
      `INSERT INTO maintenance_runs (kind, bytes, finished_at)
       VALUES ('backup', 1000, now() - make_interval(hours => $1)),
              ('backup', 2048, now() - interval '3 hours'),
              ('other', 5, now())`,
      [BACKUP_STALE_HOURS + 10],
    );
    const fresh = (await system(admin)).json().backup;
    expect(fresh.bytes).toBe(2048);
    expect(fresh.stale).toBe(false);
    expect(Date.now() - Date.parse(fresh.lastAt)).toBeGreaterThan(2.9 * 3_600_000);

    await q(`DELETE FROM maintenance_runs WHERE bytes = 2048`);
    const old = (await system(admin)).json().backup;
    expect(old).toMatchObject({ bytes: 1000, stale: true });
  });

  it('admins only: moderators and members are refused, and nothing is exposed signed out', async () => {
    expect((await system(await staff('moderator'))).statusCode).toBe(403);
    const member = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    expect((await system(member.cookie)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/admin/system' })).statusCode).toBe(401);
  });
});
