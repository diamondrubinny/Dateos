// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, type Member } from './members.js';
import {
  acceptConsents,
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('who may join, phase 62c (integration)', () => {
  let ctx: TestContext;
  let admin: Member;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    const email = 'join-admin@example.test';
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

  const settings = (body: Record<string, unknown>) =>
    api(ctx, admin, 'PATCH', '/v1/admin/instance', body);
  /** A new account trying to create its profile (ctx.today is 2026-10-20). */
  async function join(birthDate: string, extra: Record<string, unknown> = {}) {
    const cookie = await signIn(ctx, `joiner-${(n += 1)}@example.test`);
    await acceptConsents(ctx, cookie);
    return ctx.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: {
        displayName: 'Rina',
        birthDate,
        gender: 'woman',
        interestedIn: ['man'],
        intention: 'long_term',
        languages: ['he'],
        ...extra,
      },
    });
  }

  it('by default anyone 18 or over joins, as before', async () => {
    const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
    expect(info.community.join).toEqual({
      minAge: 18,
      maxAge: null,
      genders: [],
      declaration: null,
    });
    expect((await join('2000-01-01')).statusCode).toBe(201);
  });

  it('an age range: refused outside it (not suspended), accepted inside', async () => {
    expect((await settings({ joinMinAge: 50 })).statusCode).toBe(200);
    const young = await join('1996-01-01'); // 30
    expect(young.statusCode).toBe(400);
    expect(young.json().error.code).toBe('NOT_ELIGIBLE');
    const { rows } = await q(`SELECT count(*)::int AS n FROM "user" WHERE status = 'suspended'`);
    expect(rows[0].n).toBe(0); // another community may fit: no suspension
    expect((await join('1970-01-01')).statusCode).toBe(201); // 56
    await settings({ joinMinAge: 25, joinMaxAge: 40 });
    expect((await join('1980-01-01')).statusCode).toBe(400); // 46
    expect((await join('1990-01-01')).statusCode).toBe(201); // 36
  });

  it('the settings make sense: never below 18, maximum not below minimum', async () => {
    expect((await settings({ joinMinAge: 16 })).statusCode).toBe(400);
    expect((await settings({ joinMinAge: 40, joinMaxAge: 30 })).statusCode).toBe(400);
    await settings({ joinMinAge: 40 });
    expect((await settings({ joinMaxAge: 35 })).statusCode).toBe(400); // against the saved minimum
    expect((await settings({ joinMaxAge: null })).statusCode).toBe(200);
  });

  it('an age check can’t be required without a provider on the server (phase 63)', async () => {
    const res = await settings({ ageCheckRequired: true });
    expect(res.statusCode).toBe(400);
    const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
    expect(info.community.ageCheck).toBe(false);
  });

  it('members of some genders only', async () => {
    await settings({ joinGenders: ['woman', 'nonbinary'] });
    expect((await join('1995-01-01', { gender: 'man', interestedIn: ['woman'] })).statusCode).toBe(
      400,
    );
    expect((await join('1995-01-01', { gender: 'nonbinary' })).statusCode).toBe(201);
  });

  it('a declaration: refused unless confirmed; when it was confirmed is stored', async () => {
    const declaration = 'I am single and looking for marriage.';
    await settings({ joinDeclaration: declaration });
    const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
    expect(info.community.join.declaration).toBe(declaration);
    expect((await join('1995-01-01')).statusCode).toBe(400);
    expect((await join('1995-01-01', { declarationAccepted: false })).statusCode).toBe(400);
    expect((await join('1995-01-01', { declarationAccepted: true })).statusCode).toBe(201);
    const { rows } = await q(
      `SELECT count(*)::int AS n FROM profiles WHERE declaration_accepted_at IS NOT NULL`,
    );
    expect(rows[0].n).toBe(1);
    expect((await settings({ joinDeclaration: '<b>bold</b>' })).statusCode).toBe(400);
  });

  it('members already in keep their place when the rules change', async () => {
    const dana = await createMember(ctx, { name: 'Dana', gender: 'woman', interestedIn: ['man'] });
    await settings({ joinMinAge: 60, joinGenders: ['man'], joinDeclaration: 'New rules.' });
    expect((await api(ctx, dana, 'GET', '/v1/me')).json().onboarding.complete).toBe(true);
    expect((await api(ctx, dana, 'GET', '/v1/discover?limit=5')).statusCode).toBe(200);
  });
});
