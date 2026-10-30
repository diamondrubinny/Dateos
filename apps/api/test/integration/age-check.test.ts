// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { AgeCheckCallback } from '@nexaheart/shared';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAgeCheck } from '../../src/modules/age-check/service.js';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  TEST_AGE_CHECK,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('age assurance, phase 63 (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let admin: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration({ ageCheck: true });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    const email = 'age-admin@example.test';
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
    admin = { cookie } as Member;
  });

  const missing = async (m: Member) =>
    (await api(ctx, m, 'GET', '/v1/me')).json().onboarding.missing as string[];
  const start = async (m: Member) => {
    const res = await api(ctx, m, 'POST', '/v1/me/age-check');
    expect(res.statusCode).toBe(200);
    return new URL(res.json().url).searchParams.get('session')!;
  };
  /** The provider's signed result. */
  const callback = (
    body: AgeCheckCallback,
    secret: string = TEST_AGE_CHECK.AGE_CHECK_SECRET,
    signature?: string,
  ) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/age-check/callback',
      headers: { 'x-nexaheart-signature': signature ?? signAgeCheck(secret, body) },
      payload: body,
    });
  const now = () => Math.floor(ctx.clock.value / 1000);

  it('off by default: nothing changes until an admin requires it', async () => {
    const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
    expect(info.community.ageCheck).toBe(false);
    expect(await missing(noa)).toEqual([]);
    const admins = (await api(ctx, admin, 'GET', '/v1/admin/instance')).json();
    expect(admins).toMatchObject({ ageCheckConfigured: true, ageCheckRequired: false });
  });

  it('required: the step appears; a signed "over 18" passes it, only the result is kept', async () => {
    await api(ctx, admin, 'PATCH', '/v1/admin/instance', { ageCheckRequired: true });
    expect(await missing(noa)).toEqual(['age_check']);
    const res = await api(ctx, noa, 'POST', '/v1/me/age-check');
    const url = new URL(res.json().url);
    expect(url.origin + url.pathname).toBe(TEST_AGE_CHECK.AGE_CHECK_URL);
    expect(url.searchParams.get('callback')).toMatch(/\/v1\/age-check\/callback$/);
    const session = url.searchParams.get('session')!;
    const ok = await callback({ session, result: 'over_18', method: 'eudi_wallet', ts: now() });
    expect(ok.statusCode).toBe(200);
    expect(await missing(noa)).toEqual([]);
    expect((await api(ctx, noa, 'GET', '/v1/me/age-check')).json()).toMatchObject({
      required: true,
      status: 'passed',
    });
    const { rows } = await q('SELECT * FROM age_checks WHERE user_id = $1', [noa.id]);
    expect(Object.keys(rows[0]).sort()).toEqual(['checked_at', 'method', 'result', 'user_id']);
    // A replay of the same signed result is refused.
    const again = await callback({ session, result: 'over_18', method: 'eudi_wallet', ts: now() });
    expect(again.statusCode).toBe(403);
  });

  it('refuses bad signatures, old results, unknown and expired sessions', async () => {
    await api(ctx, admin, 'PATCH', '/v1/admin/instance', { ageCheckRequired: true });
    const session = await start(noa);
    const body: AgeCheckCallback = { session, result: 'over_18', method: 'x', ts: now() };
    expect((await callback(body, 'a-different-secret-0123456789abcdef0123')).statusCode).toBe(403);
    expect((await callback(body, undefined, 'f'.repeat(64))).statusCode).toBe(403);
    expect((await callback(body, undefined, 'not-hex')).statusCode).toBe(403);
    expect((await callback({ ...body, ts: now() - 3600 })).statusCode).toBe(403);
    expect(
      (await callback({ ...body, session: '00000000-0000-4000-8000-000000000000' })).statusCode,
    ).toBe(403);
    ctx.clock.value += 16 * 60_000; // past the 15 minutes
    expect((await callback({ ...body, ts: now() })).statusCode).toBe(403);
    expect(await missing(noa)).toEqual(['age_check']);
  });

  it('a new session replaces the old one; failed can be tried again', async () => {
    await api(ctx, admin, 'PATCH', '/v1/admin/instance', { ageCheckRequired: true });
    const first = await start(noa);
    const second = await start(noa);
    expect(
      (await callback({ session: first, result: 'over_18', method: 'x', ts: now() })).statusCode,
    ).toBe(403);
    expect(
      (await callback({ session: second, result: 'failed', method: 'x', ts: now() })).statusCode,
    ).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me/age-check')).json().status).toBe('failed');
    expect(await missing(noa)).toEqual(['age_check']);
    const third = await start(noa);
    await callback({ session: third, result: 'over_18', method: 'x', ts: now() });
    expect(await missing(noa)).toEqual([]);
  });

  it('under 18: the account is suspended, as with an underage date of birth', async () => {
    await api(ctx, admin, 'PATCH', '/v1/admin/instance', { ageCheckRequired: true });
    const session = await start(noa);
    await callback({ session, result: 'under_18', method: 'face_estimation', ts: now() });
    const { rows } = await q('SELECT status, suspended_reason FROM "user" WHERE id = $1', [noa.id]);
    expect(rows[0]).toEqual({ status: 'suspended', suspended_reason: 'underage' });
    expect((await api(ctx, noa, 'GET', '/v1/me')).statusCode).toBe(401); // signed out
  });

  it('in "Download my data"; deleted with the account', async () => {
    await api(ctx, admin, 'PATCH', '/v1/admin/instance', { ageCheckRequired: true });
    const session = await start(noa);
    await callback({ session, result: 'over_18', method: 'eudi_wallet', ts: now() });
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.ageCheck).toMatchObject({ result: 'over_18', method: 'eudi_wallet' });
    await api(ctx, noa, 'DELETE', '/v1/me');
    const { rows } = await q('SELECT count(*)::int AS n FROM age_checks');
    expect(rows[0].n).toBe(0);
  });
});
