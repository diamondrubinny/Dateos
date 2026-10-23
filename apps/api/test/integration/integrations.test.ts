// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHmac } from 'node:crypto';
import { IntegrationStore } from '@nexaheart/integrations';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dailySummary, processOutbound } from '../../../worker/src/outbound-jobs.js';
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

/** Everything the integrations send, and canned answers per host. */
const sent: { url: string; init: RequestInit }[] = [];
const fakeFetch = (async (input: URL | string, init: RequestInit = {}) => {
  const url = String(input);
  sent.push({ url, init });
  if (url.includes('siteverify')) {
    const body = new URLSearchParams(String(init.body));
    const success =
      body.get('response') === 'good-token' && body.get('secret') === 'captcha-secret';
    return Response.json({
      success,
      'error-codes': success ? [] : ['invalid-input-response'],
    });
  }
  if (url.includes('/chat/completions')) {
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  }
  return new Response('{}', { status: 200 });
}) as unknown as typeof fetch;
/** Public hosts resolve to a public address; "internal.test" to a private one. */
const resolve = async (host: string) =>
  host === 'internal.test' ? ['10.0.0.5'] : ['93.184.216.34'];

describe.skipIf(!integrationEnabled)('integrations (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let admin: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);

  async function staff(role: 'moderator' | 'admin') {
    const email = `${role}-${(n += 1)}@example.test`;
    const cookie = await signIn(ctx, email);
    await q(`UPDATE "user" SET role = $2 WHERE email = $1`, [email, role]);
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
  const as = (
    cookie: string,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const save = (id: string, payload: object) =>
    as(admin, 'PUT', `/v1/admin/integrations/${id}`, payload);

  beforeAll(async () => {
    ctx = await setupIntegration({
      fetch: fakeFetch,
      resolve,
      textModel: undefined,
      // The server sets email itself: that card is locked.
      integrationsEnv: { SMTP_HOST: 'smtp.server.test', SMTP_FROM: 'team@server.test' },
    });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    sent.length = 0;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    admin = await staff('admin');
  });

  it('only admins see and change integrations', async () => {
    const mod = await staff('moderator');
    expect((await as(mod, 'GET', '/v1/admin/integrations')).statusCode).toBe(403);
    expect((await api(ctx, noa, 'GET', '/v1/admin/integrations')).statusCode).toBe(403);
    expect(
      (await as(mod, 'PUT', '/v1/admin/integrations/alerts', { enabled: false })).statusCode,
    ).toBe(403);
    const list = (await as(admin, 'GET', '/v1/admin/integrations')).json();
    expect(list.editable).toBe(true);
    expect(list.integrations).toHaveLength(13);
    const email = list.integrations.find((i: { id: string }) => i.id === 'email');
    expect(email).toMatchObject({
      source: 'env',
      enabled: true,
      settings: { host: 'smtp.server.test' },
    });
    expect(list.integrations.find((i: { id: string }) => i.id === 'alerts').source).toBe('none');
  });

  it('keeps secrets encrypted and write-only, and audits changes without values', async () => {
    const hook = 'https://hooks.slack.com/services/T000/B000/very-secret-path';
    const res = await save('alerts', {
      enabled: true,
      settings: { channel: 'slack', events: 'report_urgent' },
      secrets: { webhookUrl: hook },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      source: 'dashboard',
      enabled: true,
      secretsSet: ['webhookUrl'],
    });
    expect(res.body).not.toContain('very-secret-path');
    const list = await as(admin, 'GET', '/v1/admin/integrations');
    expect(list.body).not.toContain('very-secret-path');
    const { rows } = await q(`SELECT secrets::text AS s FROM integrations WHERE id = 'alerts'`);
    expect(rows[0].s).not.toContain('very-secret-path');
    const audits = await q(
      `SELECT action, meta::text AS meta FROM audit_logs WHERE target_type = 'integration'`,
    );
    expect(audits.rows[0].action).toBe('integration.update');
    expect(audits.rows[0].meta).toContain('webhookUrl');
    expect(audits.rows[0].meta).not.toContain('very-secret-path');
    // Leaving the secret out keeps it; null removes it.
    expect(
      (await save('alerts', { enabled: true, settings: { channel: 'slack' } })).json().secretsSet,
    ).toEqual(['webhookUrl']);
    expect(
      (await save('alerts', { enabled: false, settings: {}, secrets: { webhookUrl: null } })).json()
        .secretsSet,
    ).toEqual([]);
  });

  it('refuses bad settings, a card set by the server, and saving without the key', async () => {
    expect(
      (await save('alerts', { enabled: true, settings: { channel: 'pager' } })).statusCode,
    ).toBe(422);
    expect((await save('alerts', { enabled: true, settings: { colour: 'red' } })).statusCode).toBe(
      422,
    );
    expect(
      (await save('webhooks', { enabled: true, settings: { url: 'https://example.com/in' } }))
        .statusCode,
    ).toBe(422);
    const locked = await save('email', {
      enabled: true,
      settings: { host: 'smtp.other.test', from: 'x@y.z' },
    });
    expect(locked.statusCode).toBe(422);
    expect(locked.json().error.message).toContain('set on the server');
    expect((await save('storage', { enabled: true })).statusCode).toBe(422);
    expect((await as(admin, 'DELETE', '/v1/admin/integrations/email')).statusCode).toBe(409);
    // Without INTEGRATIONS_KEY the page is read-only.
    const keyless = new IntegrationStore(ctx.services.dbHandle.db, null, {});
    expect(keyless.editable).toBe(false);
    await expect(keyless.save('alerts', { enabled: false }, 'x')).rejects.toThrow(
      'INTEGRATIONS_KEY',
    );
  });

  it('tests a webhook with a signature, and never reaches private addresses', async () => {
    await save('webhooks', {
      enabled: true,
      settings: { url: 'https://receiver.example.com/hook', events: 'member.joined' },
      secrets: { signingSecret: 'whsec_test' },
    });
    const test = (await as(admin, 'POST', '/v1/admin/integrations/webhooks/test')).json();
    expect(test).toEqual({ ok: true, message: 'Delivered.' });
    const call = sent.find((c) => c.url === 'https://receiver.example.com/hook')!;
    const headers = call.init.headers as Record<string, string>;
    const [t, v1] = headers['x-nexaheart-signature']!.split(',').map((p) => p.split('=')[1]);
    expect(v1).toBe(
      createHmac('sha256', 'whsec_test')
        .update(`${t}.${String(call.init.body)}`)
        .digest('hex'),
    );
    const view = (await as(admin, 'GET', '/v1/admin/integrations'))
      .json()
      .integrations.find((i: { id: string }) => i.id === 'webhooks');
    expect(view.lastTest).toMatchObject({ ok: true });

    await save('webhooks', {
      enabled: true,
      settings: { url: 'https://internal.test/hook', events: 'member.joined' },
      secrets: {},
    });
    const blocked = (await as(admin, 'POST', '/v1/admin/integrations/webhooks/test')).json();
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain('private network');
    expect(sent.some((c) => c.url.includes('internal.test'))).toBe(false);
  });

  it('a CAPTCHA protects sign-in links and the waitlist once it is set up', async () => {
    const signInLink = (headers: Record<string, string> = {}) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/sign-in/magic-link',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:8081',
          ...headers,
        },
        payload: { email: 'someone@example.test', callbackURL: 'http://localhost:8081/' },
      });
    expect((await signInLink()).statusCode).toBe(200);
    await save('captcha', {
      enabled: true,
      settings: { provider: 'turnstile', siteKey: 'site-key-123' },
      secrets: { secretKey: 'captcha-secret' },
    });
    const instance = await ctx.app.inject({ method: 'GET', url: '/v1/instance' });
    expect(instance.json().integrations.captcha).toEqual({
      provider: 'turnstile',
      siteKey: 'site-key-123',
    });
    expect(instance.body).not.toContain('captcha-secret');

    const without = await signInLink();
    expect(without.statusCode).toBe(403);
    expect(without.json().error.code).toBe('CAPTCHA_REQUIRED');
    expect((await signInLink({ 'x-captcha-token': 'bad-token' })).statusCode).toBe(403);
    expect((await signInLink({ 'x-captcha-token': 'good-token' })).statusCode).toBe(200);
    const verify = sent.filter((c) => c.url.includes('siteverify')).pop()!;
    expect(new URLSearchParams(String(verify.init.body)).get('remoteip')).toBeTruthy();
    const waitlist = await ctx.app.inject({
      method: 'POST',
      url: '/v1/signup/waitlist',
      payload: { email: 'later@example.test' },
    });
    expect(waitlist.statusCode).toBe(403);
    // The test button checks the secret key with the provider.
    expect((await as(admin, 'POST', '/v1/admin/integrations/captcha/test')).json()).toEqual({
      ok: true,
      message: 'The provider accepted the secret key.',
    });
  });

  it('queues webhooks and team alerts with ids and counts only', async () => {
    await save('webhooks', {
      enabled: true,
      settings: {
        url: 'https://receiver.example.com/hook',
        events: 'member.joined,report.created',
      },
      secrets: { signingSecret: 'whsec_test' },
    });
    await save('alerts', {
      enabled: true,
      settings: { channel: 'discord', events: 'report_urgent' },
      secrets: { webhookUrl: 'https://discord.com/api/webhooks/1/x' },
    });
    const dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.jobs.webhooks.map((j) => j.type)).toEqual(['member.joined']);
    expect(ctx.jobs.webhooks[0]!.data).toEqual({ memberId: dan.id });

    const report = await api(ctx, noa, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'threat',
    });
    expect(report.statusCode, report.body).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.jobs.webhooks.map((j) => j.type)).toEqual(['member.joined', 'report.created']);
    expect(ctx.jobs.alerts).toHaveLength(1);
    expect(ctx.jobs.alerts[0]!.text).toContain('urgent report');
    expect(ctx.jobs.alerts[0]!.text).not.toContain('Dan');
    expect(ctx.jobs.alerts[0]!.text).not.toContain('Noa');
    // Not subscribed: nothing queued.
    await api(ctx, noa, 'POST', '/v1/reports', { targetId: noa.id, category: 'spam' }).catch(
      () => undefined,
    );
    expect(ctx.jobs.alerts).toHaveLength(1);
  });

  it('error monitoring gets scrubbed web errors; analytics shows only what the app needs', async () => {
    await save('errors', {
      enabled: true,
      settings: { environment: 'test', webErrors: true },
      secrets: { dsn: 'https://pubkey@o1.ingest.sentry.io/42' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/client-errors',
      payload: { message: 'Crashed for dana@example.org', route: '/profile/[id]' },
    });
    expect(res.statusCode).toBe(202);
    const envelope = sent.find((c) => c.url === 'https://o1.ingest.sentry.io/api/42/envelope/')!;
    expect(String(envelope.init.body)).not.toContain('dana@example.org');
    expect(String(envelope.init.body)).toContain('/profile/[id]');

    await save('analytics', {
      enabled: true,
      settings: { provider: 'plausible', url: 'https://plausible.io', siteId: 'example.org' },
    });
    const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json().integrations;
    expect(info).toEqual({
      captcha: null,
      analytics: { provider: 'plausible', url: 'https://plausible.io', siteId: 'example.org' },
      webErrors: true,
    });
    const view = (await as(admin, 'GET', '/v1/admin/integrations'))
      .json()
      .integrations.find((i: { id: string }) => i.id === 'analytics');
    expect(view.cspHosts).toEqual(['https://plausible.io']);
  });

  it('a text model from the dashboard is used at once, through the consent rules', async () => {
    expect((await api(ctx, noa, 'GET', '/v1/me/matchmaker')).json()).toEqual({
      text: 'unavailable',
    });
    await save('ai', {
      enabled: true,
      settings: {
        provider: 'openai',
        url: 'https://llm.example.com/v1',
        model: 'small',
        external: true,
      },
      secrets: { apiKey: 'sk-test' },
    });
    // External: members must allow it first.
    expect((await api(ctx, noa, 'GET', '/v1/me/matchmaker')).json()).toEqual({
      text: 'needs_consent',
    });
    expect((await as(admin, 'POST', '/v1/admin/integrations/ai/test')).json()).toEqual({
      ok: true,
      message: 'The model answered.',
    });
    const call = sent.find((c) => c.url === 'https://llm.example.com/v1/chat/completions')!;
    expect((call.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    // Turning it off applies at once too.
    await as(admin, 'DELETE', '/v1/admin/integrations/ai');
    expect((await api(ctx, noa, 'GET', '/v1/me/matchmaker')).json()).toEqual({
      text: 'unavailable',
    });
  });

  it('the worker delivers webhooks and alerts, records each attempt, and sends the morning summary', async () => {
    await save('webhooks', {
      enabled: true,
      settings: { url: 'https://receiver.example.com/hook', events: 'member.joined' },
      secrets: { signingSecret: 'whsec_test' },
    });
    await save('alerts', {
      enabled: true,
      settings: { channel: 'slack', events: 'daily_summary' },
      secrets: { webhookUrl: 'https://hooks.slack.com/services/x' },
    });
    const outbound = {
      db: ctx.services.dbHandle.db,
      store: ctx.services.integrations.store,
      options: { fetch: fakeFetch, resolve },
      instanceName: 'NexaHeart',
      adminUrl: 'https://admin.example.org/',
    };
    const job = {
      id: 'b1f0c1de-0000-4000-8000-000000000001',
      type: 'member.joined',
      occurredAt: new Date().toISOString(),
      data: { memberId: noa.id },
    };
    expect(await processOutbound(outbound, { name: 'webhook', data: job, attemptsMade: 0 })).toBe(
      'delivered',
    );
    // A receiver that fails: the job throws (the queue retries) and the attempt is recorded.
    await save('webhooks', {
      enabled: true,
      settings: { url: 'https://internal.test/hook', events: 'member.joined' },
      secrets: {},
    });
    await expect(
      processOutbound(outbound, { name: 'webhook', data: job, attemptsMade: 1 }),
    ).rejects.toThrow();
    const deliveries = (await as(admin, 'GET', '/v1/admin/webhooks/deliveries')).json().deliveries;
    expect(deliveries.map((d: { ok: boolean; attempt: number }) => [d.ok, d.attempt])).toEqual([
      [false, 2],
      [true, 1],
    ]);
    expect(JSON.stringify(deliveries)).not.toContain(noa.id);

    const summary = await dailySummary(outbound);
    expect(summary.sent).toBe(true);
    const slack = sent.filter((c) => c.url === 'https://hooks.slack.com/services/x').pop()!;
    const text = JSON.parse(String(slack.init.body)).text as string;
    expect(text).toMatch(/0 open reports \(0 urgent\), 0 on the waitlist, \d+ new members/);
    expect(text).not.toContain('Noa');
  });
});
