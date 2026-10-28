// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { CREDIT_AUTHOR, signedInDevicesSchema } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const ANDROID_APP = 'okhttp/4.12.0';

describe.skipIf(!integrationEnabled)('your devices and push tokens (integration)', () => {
  let ctx: TestContext;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  const call = (cookie: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const devices = async (cookie: string) =>
    signedInDevicesSchema.parse((await call(cookie, 'GET', '/v1/me/sessions')).json()).devices;

  it('lists where I’m signed in with a coarse label, and never stores the browser or IP', async () => {
    const laptop = await signIn(ctx, 'noa@example.test', { userAgent: FIREFOX });
    await signIn(ctx, 'noa@example.test', { userAgent: ANDROID_APP });
    const list = await devices(laptop);
    expect(list.map((d) => d.device)).toEqual(
      expect.arrayContaining([
        { kind: 'app', os: 'Android', browser: null },
        { kind: 'web', os: 'Linux', browser: 'Firefox' },
      ]),
    );
    expect(list.find((d) => d.current)?.device.browser).toBe('Firefox');
    const stored = await q('SELECT ip_address, user_agent, device_label FROM session');
    expect(stored.rows.every((r) => r.ip_address === null && r.user_agent === null)).toBe(true);
    expect(stored.rows.map((r) => r.device_label).sort()).toEqual([
      'app:android',
      'web:Firefox:Linux',
    ]);
  });

  it('signs out one device; someone else’s session id is “not found”', async () => {
    const laptop = await signIn(ctx, 'noa@example.test', { userAgent: FIREFOX });
    const phone = await signIn(ctx, 'noa@example.test', { userAgent: ANDROID_APP });
    const dan = await signIn(ctx, 'dan@example.test');
    const phoneId = (await devices(laptop)).find((d) => d.device.kind === 'app')!.id;
    // Dan can't see or end Noa's sessions.
    expect((await call(dan, 'DELETE', `/v1/me/sessions/${phoneId}`)).statusCode).toBe(404);
    expect((await call(phone, 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await call(laptop, 'DELETE', `/v1/me/sessions/${phoneId}`)).statusCode).toBe(200);
    expect((await call(phone, 'GET', '/v1/me')).statusCode).toBe(401);
    expect((await call(laptop, 'GET', '/v1/me')).statusCode).toBe(200);
    const audits = await q(`SELECT meta FROM audit_logs WHERE action = 'session.revoked'`);
    expect(audits.rows).toEqual([{ meta: { current: false } }]);
  });

  it('signs out everywhere else and keeps this device', async () => {
    const laptop = await signIn(ctx, 'noa@example.test', { userAgent: FIREFOX });
    const phone = await signIn(ctx, 'noa@example.test', { userAgent: ANDROID_APP });
    const tablet = await signIn(ctx, 'noa@example.test');
    const dan = await signIn(ctx, 'dan@example.test');
    const res = await call(laptop, 'POST', '/v1/me/sessions/sign-out-others');
    expect(res.json()).toEqual({ ok: true, signedOut: 2 });
    for (const cookie of [phone, tablet]) {
      expect((await call(cookie, 'GET', '/v1/me')).statusCode).toBe(401);
    }
    expect((await call(laptop, 'GET', '/v1/me')).statusCode).toBe(200);
    // Other people's sessions are untouched.
    expect((await call(dan, 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await devices(laptop)).length).toBe(1);
  });

  it('requires sign-in', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/sessions' });
    expect(res.statusCode).toBe(401);
  });

  describe('push tokens bound to the device', () => {
    const token = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
    const secret = 'a'.repeat(43);
    const owner = async () => (await q('SELECT user_id FROM push_tokens')).rows[0]?.user_id;
    const idOf = async (cookie: string) =>
      (await call(cookie, 'GET', '/v1/me')).json().user.id as string;

    it('moves a token to another account only with the same device secret', async () => {
      const noa = await signIn(ctx, 'noa@example.test');
      const dan = await signIn(ctx, 'dan@example.test');
      const register = (cookie: string, deviceSecret?: string) =>
        call(cookie, 'POST', '/v1/me/push-tokens', {
          token,
          platform: 'ios',
          ...(deviceSecret ? { deviceSecret } : {}),
        });
      expect((await register(noa, secret)).statusCode).toBe(200);
      const stored = await q('SELECT device_secret_hash FROM push_tokens');
      // Only a hash is kept.
      expect(stored.rows[0].device_secret_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.rows[0].device_secret_hash).not.toContain(secret);
      // Knowing the token isn't enough: no secret, or a different one, is refused.
      expect((await register(dan)).statusCode).toBe(409);
      expect((await register(dan, 'b'.repeat(43))).statusCode).toBe(409);
      expect(await owner()).toBe(await idOf(noa));
      // The same phone (same secret), someone else signing in: the token moves.
      expect((await register(dan, secret)).statusCode).toBe(200);
      expect(await owner()).toBe(await idOf(dan));
    });

    it('a token from before phase 29 takes the first secret it’s sent with', async () => {
      const noa = await signIn(ctx, 'noa@example.test');
      const dan = await signIn(ctx, 'dan@example.test');
      await call(noa, 'POST', '/v1/me/push-tokens', { token, platform: 'android' });
      expect(
        (
          await call(noa, 'POST', '/v1/me/push-tokens', {
            token,
            platform: 'android',
            deviceSecret: secret,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await call(dan, 'POST', '/v1/me/push-tokens', { token, platform: 'android' })).statusCode,
      ).toBe(409);
    });

    it('refuses a malformed secret', async () => {
      const noa = await signIn(ctx, 'noa@example.test');
      const res = await call(noa, 'POST', '/v1/me/push-tokens', {
        token,
        platform: 'ios',
        deviceSecret: 'short',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it('the instance credits NexaHeart’s author', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/instance' });
    expect(res.json().poweredBy.author).toEqual({
      name: CREDIT_AUTHOR,
      url: 'https://github.com/diamondrubinny',
    });
  });
});
