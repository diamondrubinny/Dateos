// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { apiErrorSchema, SENSITIVE_CONSENT_VERSION } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  acceptConsents,
  signIn,
  teardown,
  validProfile,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('auth + profile (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  const me = (cookie?: string) =>
    ctx.app.inject({ method: 'GET', url: '/v1/me', headers: cookie ? { cookie } : {} });

  it('rejects anonymous access', async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('signs in with a magic link and reports onboarding steps', async () => {
    const cookie = await signIn(ctx, 'noa@example.test');
    expect(cookie).toMatch(/nexaheart\.session_token=/);
    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('noa@example.test');
    expect(res.json().onboarding).toEqual({
      complete: false,
      missing: ['consents', 'profile', 'photos', 'prompts', 'location'],
    });
  });

  it('does not reveal whether an email is registered, and throttles per inbox', async () => {
    await signIn(ctx, 'known@example.test');
    const send = (email: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/sign-in/magic-link',
        headers: { origin: 'http://localhost:8081' },
        payload: { email, callbackURL: 'http://localhost:8081/' },
      });
    const known = await send('known@example.test');
    const unknown = await send('unknown@example.test');
    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.body).toBe(unknown.body);

    ctx.mail.length = 0;
    for (let i = 0; i < 7; i += 1) expect((await send('victim@example.test')).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.mail.filter((m) => m.to === 'victim@example.test')).toHaveLength(5);

    // Someone else spending that quota from their IP doesn't lock the owner out on theirs.
    const fromOwner = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/magic-link',
      remoteAddress: '198.51.100.7',
      headers: { origin: 'http://localhost:8081' },
      payload: { email: 'victim@example.test', callbackURL: 'http://localhost:8081/' },
    });
    expect(fromOwner.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.mail.filter((m) => m.to === 'victim@example.test')).toHaveLength(6);
  });

  it('magic links are single-use', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/magic-link',
      headers: { origin: 'http://localhost:8081' },
      payload: { email: 'once@example.test', callbackURL: 'http://localhost:8081/' },
    });
    await new Promise((r) => setTimeout(r, 20));
    const link = new URL(/https?:\/\/\S+/.exec(ctx.mail.at(-1)!.text)![0]);
    const first = await ctx.app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
    const second = await ctx.app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
    expect(String(first.headers['set-cookie'])).toContain('session_token');
    expect(String(second.headers['set-cookie'] ?? '')).not.toContain('session_token=');
  });

  it('creates a profile with default preferences; birth date is final', async () => {
    const cookie = await signIn(ctx, 'noa@example.test');
    await acceptConsents(ctx, cookie);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: validProfile,
    });
    expect(created.statusCode).toBe(201);

    const body = (await me(cookie)).json();
    expect(body.profile).toMatchObject({
      displayName: 'Noa',
      age: 31,
      interestedIn: ['man', 'woman'],
    });
    expect(body.preferences).toEqual({ ageMin: 26, ageMax: 36, maxDistanceKm: 50, intentions: [] });

    const again = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: validProfile,
    });
    expect(again.statusCode).toBe(409);

    const changeBirthDate = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: { birthDate: '2001-01-01' },
    });
    expect(changeBirthDate.statusCode).toBe(400);

    const rename = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: { displayName: 'Noa B.', bio: '' },
    });
    expect(rename.statusCode).toBe(200);
    expect((await me(cookie)).json().profile).toMatchObject({ displayName: 'Noa B.', bio: null });
  });

  it('suspends underage accounts and revokes their sessions', async () => {
    const cookie = await signIn(ctx, 'teen@example.test');
    await acceptConsents(ctx, cookie);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: { ...validProfile, birthDate: '2009-10-21' }, // turns 17 tomorrow
    });
    expect(res.statusCode).toBe(403);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('UNDERAGE');
    expect((await me(cookie)).statusCode).toBe(401);

    const { rows } = await ctx.services.dbHandle.pool.query(
      `SELECT status, suspended_reason FROM "user" WHERE email = 'teen@example.test'`,
    );
    expect(rows[0]).toEqual({ status: 'suspended', suspended_reason: 'underage' });
    const profiles = await ctx.services.dbHandle.pool.query(
      'SELECT count(*)::int AS n FROM profiles',
    );
    expect(profiles.rows[0].n).toBe(0);

    // A new sign-in must not get around the suspension: the member can only see the account
    // state and delete the account (right to erasure).
    const again = await signIn(ctx, 'teen@example.test');
    const state = await me(again);
    expect(state.statusCode).toBe(200);
    expect(state.json().user.status).toBe('suspended');
    for (const [method, url, payload] of [
      ['POST', '/v1/me/profile', { ...validProfile, birthDate: '1990-01-01' }],
      ['PUT', '/v1/me/preferences', { ageMin: 18, ageMax: 40, maxDistanceKm: 20, intentions: [] }],
      ['GET', '/v1/discover', undefined],
      ['GET', '/v1/me/verification', undefined],
    ] as const) {
      const blocked = await ctx.app.inject({
        method,
        url,
        headers: { cookie: again },
        ...(payload ? { payload } : {}),
      });
      expect(blocked.statusCode, `${method} ${url}`).toBe(403);
    }
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { cookie: again },
    });
    expect(del.statusCode).toBe(200);
  });

  it('accepts users on their 18th birthday', async () => {
    const cookie = await signIn(ctx, 'adult@example.test');
    await acceptConsents(ctx, cookie);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: { ...validProfile, birthDate: '2008-10-20' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('records versioned consents and rejects outdated document versions', async () => {
    const cookie = await signIn(ctx, 'noa@example.test');
    const put = (consents: unknown) =>
      ctx.app.inject({
        method: 'PUT',
        url: '/v1/me/consents',
        headers: { cookie },
        payload: { consents },
      });
    expect((await put([{ kind: 'terms', granted: true, version: '1999-01' }])).statusCode).toBe(
      409,
    );
    const ok = await put([
      { kind: 'terms', granted: true, version: ctx.env.TERMS_VERSION },
      { kind: 'privacy', granted: true, version: ctx.env.PRIVACY_VERSION },
      { kind: 'ai_cloud', granted: false, version: '1' },
    ]);
    expect(ok.statusCode).toBe(200);
    // Terms and privacy alone are not enough: sensitive data needs its own explicit consent.
    expect((await me(cookie)).json().onboarding.missing).toContain('consents');
    expect((await put([{ kind: 'sensitive', granted: true, version: '0' }])).statusCode).toBe(409);
    await put([{ kind: 'sensitive', granted: true, version: SENSITIVE_CONSENT_VERSION }]);
    const body = (await me(cookie)).json();
    expect(body.consents).toEqual({ terms: true, privacy: true, sensitive: true, ai_cloud: false });
    expect(body.onboarding.missing).not.toContain('consents');

    await put([{ kind: 'ai_cloud', granted: true, version: '1' }]);
    expect((await me(cookie)).json().consents.ai_cloud).toBe(true); // latest row wins
  });

  it('validates prompts and keeps their order', async () => {
    const cookie = await signIn(ctx, 'noa@example.test');
    const put = (prompts: unknown) =>
      ctx.app.inject({
        method: 'PUT',
        url: '/v1/me/prompts',
        headers: { cookie },
        payload: { prompts },
      });
    const dup = await put([
      { promptKey: 'green_flag', answer: 'a' },
      { promptKey: 'green_flag', answer: 'b' },
    ]);
    expect(dup.statusCode).toBe(400);
    expect((await put([{ promptKey: 'not_a_prompt', answer: 'x' }])).statusCode).toBe(400);
    expect(
      (
        await put([
          { promptKey: 'first_date_idea', answer: 'Hummus and a sunset walk' },
          { promptKey: 'green_flag', answer: 'Kind to waiters' },
        ])
      ).statusCode,
    ).toBe(200);
    expect(
      (await me(cookie)).json().prompts.map((p: { promptKey: string }) => p.promptKey),
    ).toEqual(['first_date_idea', 'green_flag']);
  });

  it('rejects invalid preference ranges', async () => {
    const cookie = await signIn(ctx, 'noa@example.test');
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers: { cookie },
      payload: { ageMin: 40, ageMax: 30, maxDistanceKm: 20, intentions: [] },
    });
    expect(res.statusCode).toBe(400);
    const underMin = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/preferences',
      headers: { cookie },
      payload: { ageMin: 16, ageMax: 30, maxDistanceKm: 20, intentions: [] },
    });
    expect(underMin.statusCode).toBe(400);
  });

  it('deletes the account and everything it owns', async () => {
    const cookie = await signIn(ctx, 'bye@example.test');
    await acceptConsents(ctx, cookie);
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: validProfile,
    });
    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/prompts',
      headers: { cookie },
      payload: { prompts: [{ promptKey: 'green_flag', answer: 'Honesty' }] },
    });
    const res = await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect((await me(cookie)).statusCode).toBe(401);

    const { rows } = await ctx.services.dbHandle.pool.query(`
      SELECT (SELECT count(*) FROM "user")::int AS users, (SELECT count(*) FROM session)::int AS sessions,
             (SELECT count(*) FROM profiles)::int AS profiles, (SELECT count(*) FROM prompts)::int AS prompts,
             (SELECT count(*) FROM preferences)::int AS prefs`);
    expect(rows[0]).toEqual({ users: 0, sessions: 0, profiles: 0, prompts: 0, prefs: 0 });
    const auditRows = await ctx.services.dbHandle.pool.query(`SELECT action, meta FROM audit_logs`);
    expect(auditRows.rows).toEqual([{ action: 'account.deleted', meta: null }]);
  });

  it('exposes public instance info without auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/instance' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'NexaHeart', auth: { magicLink: true } });
  });
});
