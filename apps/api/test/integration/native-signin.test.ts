import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('native sign-in hand-off (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };
  /** Requests a link with a native callback and "clicks" it; returns the redirect response. */
  const click = async (email: string, callbackURL: string) => {
    const before = ctx.mail.length;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/magic-link',
      payload: { email, callbackURL },
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const text = ctx.mail.slice(before).find((m) => m.to === email)!.text;
    const link = new URL(/https?:\/\/\S+/.exec(text)![0]);
    return ctx.app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
  };
  const exchange = (code: string, verifier: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/native/exchange',
      payload: { code, verifier },
    });

  it('hands the session over only with the secret, once, and never in a URL', async () => {
    const { verifier, challenge } = pkce();
    const res = await click('maya@example.test', `dateos://auth/callback?challenge=${challenge}`);
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toMatch(/^dateos:\/\/auth\/callback\?code=[A-Za-z0-9_-]{43}$/);
    expect(location).not.toContain('cookie');
    expect(location).not.toContain('session');
    expect(res.headers['set-cookie']).toBeUndefined(); // the browser doesn't get a session either
    const code = new URL(location).searchParams.get('code')!;

    // An app that intercepted the link has the code but not the secret: the code is burnt.
    expect((await exchange(code, pkce().verifier)).statusCode).toBe(400);
    expect((await exchange(code, verifier)).statusCode).toBe(400);
  });

  it('the app that started the sign-in gets a working session', async () => {
    const { verifier, challenge } = pkce();
    const res = await click('noa@example.test', `dateos://auth/callback?challenge=${challenge}`);
    const code = new URL(res.headers.location as string).searchParams.get('code')!;
    const ok = await exchange(code, verifier);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    const raw = ok.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw!]).map((c) => c.split(';')[0]).join('; ');
    expect(cookie).toContain('session_token=');
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('noa@example.test');
    // Single use.
    expect((await exchange(code, verifier)).statusCode).toBe(400);
  });

  it('without a challenge there is no code (old app versions get an error, not a session)', async () => {
    const res = await click('dan@example.test', 'dateos://auth/callback');
    expect(res.headers.location).toBe('dateos://auth/callback?error=sign_in_failed');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('web sign-in is unchanged', async () => {
    const res = await click('web@example.test', 'http://localhost:8081/');
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['set-cookie'])).toContain('session_token=');
  });

  it('codes expire', async () => {
    const { verifier, challenge } = pkce();
    const res = await click('late@example.test', `dateos://auth/callback?challenge=${challenge}`);
    const code = new URL(res.headers.location as string).searchParams.get('code')!;
    const key = `dateos:native-code:${createHash('sha256').update(code).digest('hex')}`;
    expect(await ctx.redis.ttl(key)).toBeGreaterThan(100);
    await ctx.redis.del(key);
    expect((await exchange(code, verifier)).statusCode).toBe(400);
  });
});
