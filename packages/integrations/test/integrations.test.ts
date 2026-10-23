// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHmac, randomBytes } from 'node:crypto';
import { routePattern } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import {
  checkUrl,
  decryptSecret,
  deliverWebhook,
  encryptSecret,
  fromEnv,
  IntegrationInputError,
  isPrivateAddress,
  parseDsn,
  parseIntegrationsKey,
  reportError,
  scrub,
  sendAlert,
  setByEnv,
  signWebhook,
  validateUpdate,
  verifyCaptcha,
  webhookPayload,
} from '../src/index.js';

const key = randomBytes(32);
const publicDns = async () => ['93.184.216.34'];

/** A fetch that records what was sent and answers with a status and JSON. */
function fakeFetch(status = 200, json: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('secrets', () => {
  it('round-trips, and fails closed on a wrong key, field or tampering', () => {
    const sealed = encryptSecret(key, 'email.password', 'hunter2');
    expect(sealed).not.toContain('hunter2');
    expect(decryptSecret(key, 'email.password', sealed)).toBe('hunter2');
    expect(decryptSecret(randomBytes(32), 'email.password', sealed)).toBeNull();
    expect(decryptSecret(key, 'ai.apiKey', sealed)).toBeNull();
    const [iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(
      decryptSecret(key, 'email.password', [iv, tag, flipped.toString('base64url')].join('.')),
    ).toBeNull();
    expect(encryptSecret(key, 'x', 'same')).not.toBe(encryptSecret(key, 'x', 'same'));
  });

  it('reads the key as hex or base64, and only 32 bytes', () => {
    expect(parseIntegrationsKey(key.toString('hex'))?.equals(key)).toBe(true);
    expect(parseIntegrationsKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseIntegrationsKey('short')).toBeNull();
    expect(parseIntegrationsKey(undefined)).toBeNull();
  });
});

describe('outbound addresses (SSRF)', () => {
  it('knows private, loopback, link-local and metadata addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });

  it('refuses http, passwords, private hosts and unknown hosts, unless allowed', async () => {
    await expect(checkUrl('http://example.com', { resolve: publicDns })).rejects.toThrow('https');
    await expect(checkUrl('https://u:p@example.com', { resolve: publicDns })).rejects.toThrow(
      'password',
    );
    await expect(checkUrl('https://169.254.169.254/latest')).rejects.toThrow('private');
    await expect(
      checkUrl('https://internal.test', { resolve: async () => ['10.0.0.5'] }),
    ).rejects.toThrow('private');
    await expect(checkUrl('https://nowhere.test', { resolve: async () => [] })).rejects.toThrow(
      'found',
    );
    await expect(
      checkUrl('http://localhost:11434', {
        allowPrivate: true,
        resolve: async () => ['127.0.0.1'],
      }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('never follows redirects', async () => {
    const redirect = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://10.0.0.1' },
      })) as unknown as typeof fetch;
    const result = await deliverWebhook(
      { url: 'https://hooks.example.com/x', signingSecret: 's' },
      webhookPayload('test', {}),
      { fetch: redirect, resolve: publicDns },
    );
    expect(result).toMatchObject({ ok: false, message: 'The address redirected.' });
  });
});

describe('environment wins', () => {
  it('locks an integration set on the server, and reads it from there', () => {
    const env = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_FROM: 'a@b.c',
      SMTP_PASSWORD: 'pw',
    };
    expect(setByEnv('email', env)).toBe(true);
    expect(setByEnv('captcha', env)).toBe(false);
    expect(setByEnv('email', { SMTP_HOST: '  ' })).toBe(false);
    expect(fromEnv('email', env)).toMatchObject({
      source: 'env',
      settings: { host: 'smtp.example.com', port: 465, secure: true },
      secrets: { password: 'pw' },
    });
    expect(fromEnv('ai', { ICEBREAKERS_PROVIDER: 'template' }).enabled).toBe(false);
  });
});

describe('validating dashboard settings', () => {
  const ok = (
    settings: Record<string, string | number | boolean>,
    secrets: Record<string, string | null> = {},
  ) => validateUpdate('alerts', { enabled: true, settings, secrets }, []);

  it('accepts known fields and normalises them', () => {
    expect(
      ok(
        { channel: 'slack', events: 'report_urgent, waitlist_new,report_urgent' },
        { webhookUrl: 'https://hooks.slack.com/x' },
      ),
    ).toEqual({
      settings: { channel: 'slack', events: 'report_urgent,waitlist_new' },
      secrets: { webhookUrl: 'https://hooks.slack.com/x' },
    });
  });

  it('refuses unknown fields, wrong types, secrets as settings and missing required ones', () => {
    expect(() => ok({ channel: 'pager' })).toThrow(IntegrationInputError);
    expect(() => ok({ channel: 'slack', color: 'red' })).toThrow('Unknown setting');
    expect(() => ok({ channel: 'slack', webhookUrl: 'x' })).toThrow('Unknown setting');
    expect(() => ok({ channel: 'slack', events: 'everything' })).toThrow('unknown value');
    expect(() =>
      validateUpdate(
        'webhooks',
        { enabled: true, settings: { url: 'https://a.example' }, secrets: {} },
        [],
      ),
    ).toThrow('signingSecret is required');
    expect(() =>
      validateUpdate(
        'webhooks',
        { enabled: true, settings: { url: 'ftp://a.example' }, secrets: { signingSecret: 'x' } },
        [],
      ),
    ).toThrow('http');
    expect(() =>
      validateUpdate(
        'email',
        { enabled: true, settings: { host: 'h', from: 'f', port: 70000 }, secrets: {} },
        [],
      ),
    ).toThrow('range');
    expect(() =>
      validateUpdate('storage', { enabled: true, settings: {}, secrets: {} }, []),
    ).toThrow('server');
    // A secret already stored counts; removing it doesn't.
    expect(() =>
      validateUpdate(
        'webhooks',
        { enabled: true, settings: { url: 'https://a.example' }, secrets: {} },
        ['signingSecret'],
      ),
    ).not.toThrow();
    expect(() =>
      validateUpdate(
        'webhooks',
        { enabled: true, settings: { url: 'https://a.example' }, secrets: { signingSecret: null } },
        ['signingSecret'],
      ),
    ).toThrow('required');
    // Turned off: nothing is required.
    expect(() =>
      validateUpdate('webhooks', { enabled: false, settings: {}, secrets: {} }, []),
    ).not.toThrow();
  });
});

describe('senders', () => {
  it('verifies a CAPTCHA answer with the provider, with the IP', async () => {
    const yes = fakeFetch(200, { success: true });
    expect(
      await verifyCaptcha(
        { provider: 'turnstile', secretKey: 'sk', token: 'tok', ip: '1.2.3.4' },
        { fetch: yes.fn, resolve: publicDns },
      ),
    ).toBe(true);
    expect(yes.calls[0]!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(String(yes.calls[0]!.init.body)).toBe('secret=sk&response=tok&remoteip=1.2.3.4');
    const no = fakeFetch(200, { success: false });
    expect(
      await verifyCaptcha(
        { provider: 'hcaptcha', secretKey: 'sk', token: 'tok' },
        { fetch: no.fn, resolve: publicDns },
      ),
    ).toBe(false);
    expect(await verifyCaptcha({ provider: 'hcaptcha', secretKey: 'sk', token: '' })).toBe(false);
  });

  it('sends alerts in each chat format, with no mentions', async () => {
    const f = fakeFetch();
    await sendAlert(
      { channel: 'discord', webhookUrl: 'https://discord.com/api/webhooks/1/x' },
      'Hi',
      { fetch: f.fn, resolve: publicDns },
    );
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
      content: 'Hi',
      allowed_mentions: { parse: [] },
    });
    await sendAlert({ channel: 'telegram', botToken: '123:abc', chatId: '-100' }, 'Hi', {
      fetch: f.fn,
      resolve: publicDns,
    });
    expect(f.calls[1]!.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect((await sendAlert({ channel: 'telegram', botToken: 'bad token' }, 'Hi')).ok).toBe(false);
    expect((await sendAlert({ channel: 'slack' }, 'Hi')).ok).toBe(false);
  });

  it('signs webhooks so receivers can check them', async () => {
    const f = fakeFetch(202);
    const payload = webhookPayload('member.joined', { memberId: 'abc' });
    const result = await deliverWebhook(
      { url: 'https://hooks.example.com/in', signingSecret: 'whsec' },
      payload,
      {
        fetch: f.fn,
        resolve: publicDns,
        nowSeconds: 1_700_000_000,
      },
    );
    expect(result.ok).toBe(true);
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    const body = String(f.calls[0]!.init.body);
    const mac = createHmac('sha256', 'whsec').update(`1700000000.${body}`).digest('hex');
    expect(headers['x-nexaheart-signature']).toBe(`t=1700000000,v1=${mac}`);
    expect(signWebhook('whsec', body, 1_700_000_000)).toBe(headers['x-nexaheart-signature']);
    expect(JSON.parse(body)).toMatchObject({ type: 'member.joined', data: { memberId: 'abc' } });
  });

  it('reports errors to Sentry without personal data', async () => {
    expect(parseDsn('https://pub@o1.ingest.sentry.io/42')).toEqual({
      endpoint: 'https://o1.ingest.sentry.io/api/42/envelope/',
      publicKey: 'pub',
    });
    expect(parseDsn('https://glitch.example.com/prefix/7')).toBeNull();
    expect(parseDsn('https://k@glitch.example.com/prefix/7')?.endpoint).toBe(
      'https://glitch.example.com/prefix/api/7/envelope/',
    );
    expect(
      scrub('User noa@example.com 3f2a1b4c-1111-2222-3333-444455556666 at /v1/x?token=abc'),
    ).toBe('User [email] [id] at /v1/x?[…]');
    const f = fakeFetch();
    const error = new Error('Failed for dana@example.org');
    await reportError(
      'https://pub@o1.ingest.sentry.io/42',
      { type: 'Error', message: error.message, stack: error.stack },
      { environment: 'test', platform: 'node' },
      { fetch: f.fn, resolve: publicDns },
    );
    const sent = String(f.calls[0]!.init.body);
    expect(sent).not.toContain('dana@example.org');
    expect(sent).toContain('[email]');
    expect((f.calls[0]!.init.headers as Record<string, string>)['x-sentry-auth']).toContain(
      'sentry_key=pub',
    );
  });

  it('turns routes into patterns, so no id leaves the app', () => {
    expect(routePattern('/profile/3f2a1b4c-1111-2222-3333-444455556666')).toBe('/profile/[id]');
    expect(routePattern('/take/AbCdEfGhIjKlMnOpQrStUvWx?x=1')).toBe('/take/[id]');
    expect(routePattern('/events/12')).toBe('/events/[id]');
    expect(routePattern('/settings')).toBe('/settings');
  });
});
