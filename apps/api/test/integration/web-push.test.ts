// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendPush } from '../../../worker/src/push.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  TEST_WEB_PUSH_KEY,
  type TestContext,
} from './setup.js';

const keys = { p256dh: `B${'Q'.repeat(86)}`, auth: 'k'.repeat(22) };
const fcm = (n: number | string) => `https://fcm.googleapis.com/fcm/send/browser-${n}`;

describe.skipIf(!integrationEnabled)('notifications in the web app (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const subs = async (m: Member) =>
    (
      await ctx.services.dbHandle.pool.query(
        `SELECT endpoint, locale FROM web_push_subscriptions WHERE user_id = $1 ORDER BY created_at`,
        [m.id],
      )
    ).rows as { endpoint: string; locale: string }[];

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  it('tells the web app whether it can turn notifications on, and the key to use', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/push/web' });
    expect(res.json()).toEqual({ enabled: true, publicKey: TEST_WEB_PUSH_KEY });
  });

  it('keeps a browser’s subscription for its account, and counts it as a device', async () => {
    const res = await api(ctx, noa, 'POST', '/v1/me/web-push', {
      endpoint: fcm(1),
      keys,
      locale: 'he',
    });
    expect(res.statusCode).toBe(200);
    expect(await subs(noa)).toEqual([{ endpoint: fcm(1), locale: 'he' }]);
    expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().pushDevices).toBe(1);
    // Signed out: nothing.
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/me/web-push',
          payload: { endpoint: fcm(2), keys },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('only accepts browser push services: the worker posts nowhere else', async () => {
    for (const endpoint of [
      'https://localhost/x',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com.evil.example/x',
      'http://fcm.googleapis.com/fcm/send/x',
    ]) {
      const res = await api(ctx, noa, 'POST', '/v1/me/web-push', { endpoint, keys });
      expect(res.statusCode, endpoint).toBe(400);
    }
    expect(await subs(noa)).toEqual([]);
  });

  it('a browser belongs to whoever subscribed there last; each removes only their own', async () => {
    await api(ctx, noa, 'POST', '/v1/me/web-push', { endpoint: fcm('shared'), keys });
    await api(ctx, dan, 'POST', '/v1/me/web-push', { endpoint: fcm('shared'), keys });
    expect(await subs(noa)).toEqual([]);
    expect((await subs(dan)).map((s) => s.endpoint)).toEqual([fcm('shared')]);
    await api(ctx, noa, 'DELETE', '/v1/me/web-push', { endpoint: fcm('shared') });
    expect(await subs(dan)).toHaveLength(1);
    await api(ctx, dan, 'DELETE', '/v1/me/web-push', { endpoint: fcm('shared') });
    expect(await subs(dan)).toEqual([]);
  });

  it('keeps at most 10 browsers per account, the newest', async () => {
    for (let i = 1; i <= 12; i += 1) {
      await api(ctx, noa, 'POST', '/v1/me/web-push', { endpoint: fcm(i), keys });
    }
    const left = (await subs(noa)).map((s) => s.endpoint);
    expect(left).toHaveLength(10);
    expect(left).not.toContain(fcm(1));
    expect(left).toContain(fcm(12));
  });

  it('“Download my data” names the push service, not the address (a way to reach the browser)', async () => {
    await api(ctx, noa, 'POST', '/v1/me/web-push', { endpoint: fcm('secret-token'), keys });
    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    const raw = strFromU8(zip['data.json']!);
    expect(JSON.parse(raw).browserNotifications).toEqual([
      expect.objectContaining({ pushService: 'fcm.googleapis.com' }),
    ]);
    expect(raw).not.toContain('secret-token');
  });
});

describe.skipIf(!integrationEnabled)('the worker sends to browsers (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let sent: { endpoint: string; payload: string; options: Record<string, unknown> }[];
  let answer: number;
  const context = () => ({
    db: ctx.services.dbHandle.db,
    redis: ctx.redis,
    log: { info: () => undefined, warn: () => undefined },
    provider: 'disabled' as const, // no phone app service: web notifications work on their own
    expoUrl: 'http://127.0.0.1:9/push',
    webPush: {
      publicKey: TEST_WEB_PUSH_KEY,
      privateKey: 'p'.repeat(43),
      subject: 'https://ahava.example.org',
      send: (async (
        sub: { endpoint: string },
        payload: string,
        options: Record<string, unknown>,
      ) => {
        sent.push({ endpoint: sub.endpoint, payload, options });
        if (answer >= 400) throw Object.assign(new Error('push service'), { statusCode: answer });
        return { statusCode: answer, body: '', headers: {} };
      }) as never,
    },
  });

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    sent = [];
    answer = 201;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;
    await api(ctx, noa, 'POST', '/v1/me/web-push', { endpoint: fcm('noa'), keys, locale: 'he' });
  });

  it('sends the same content as the phone app: the community and a generic sentence, no names', async () => {
    expect(await sendPush(context(), { userId: noa.id, kind: 'message', matchId })).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.endpoint).toBe(fcm('noa'));
    const payload = JSON.parse(sent[0]!.payload);
    expect(payload).toEqual({
      title: 'NexaHeart',
      body: 'יש לך הודעה חדשה',
      kind: 'message',
      id: matchId,
      badge: 0,
    });
    expect(sent[0]!.payload).not.toContain('Dan');
    expect(sent[0]!.options).toMatchObject({
      vapidDetails: { subject: 'https://ahava.example.org', publicKey: TEST_WEB_PUSH_KEY },
      urgency: 'normal',
    });
  });

  it('phase 72: the declarative form, the number on the icon, and "I\'m OK" on a check-in', async () => {
    const withApp = () => {
      const c = context();
      return { ...c, webPush: { ...c.webPush, appUrl: 'https://ahava.example.org/' } };
    };
    // Dan writes: one chat with unread messages.
    await api(ctx, dan, 'POST', `/v1/matches/${matchId}/messages`, {
      clientId: 'msg-badge-1-xxxx',
      text: 'Hi Noa!',
    });
    expect(await sendPush(withApp(), { userId: noa.id, kind: 'match', matchId })).toBe('sent');
    const payload = JSON.parse(sent.at(-1)!.payload);
    expect(payload).toMatchObject({
      title: 'NexaHeart',
      kind: 'match',
      badge: 1,
      web_push: 8030,
      notification: {
        title: 'NexaHeart',
        body: 'יש התאמה! כדאי להגיד שלום',
        navigate: `https://ahava.example.org/chat/${matchId}`,
        lang: 'he',
        app_badge: '1',
      },
    });
    expect(payload.actions).toBeUndefined();
    expect(sent.at(-1)!.payload).not.toContain('Dan');

    // A muted chat doesn't count.
    await api(ctx, noa, 'PUT', `/v1/matches/${matchId}/prefs`, { muted: true });
    await ctx.redis.flushdb();
    await sendPush(withApp(), { userId: noa.id, kind: 'visible', matchId: noa.id });
    expect(JSON.parse(sent.at(-1)!.payload).badge).toBe(0);
    await api(ctx, noa, 'PUT', `/v1/matches/${matchId}/prefs`, { muted: false });

    // "I'm OK" on a check-in reminder, opening the check-in.
    await ctx.redis.flushdb();
    await sendPush(withApp(), { userId: noa.id, kind: 'checkin', matchId: noa.id });
    const checkin = JSON.parse(sent.at(-1)!.payload);
    expect(checkin.actions).toEqual([{ action: 'ok', title: 'הכול בסדר' }]);
    expect(checkin.notification.actions).toEqual([
      { action: 'ok', title: 'הכול בסדר', navigate: 'https://ahava.example.org/checkin?ok=1' },
    ]);

    // Turned off: no number. Discreet: no number and no button (they'd give it away).
    await api(ctx, noa, 'PUT', '/v1/me/settings', { appBadge: false });
    expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().appBadge).toBe(false);
    await ctx.redis.flushdb();
    await sendPush(withApp(), { userId: noa.id, kind: 'match', matchId });
    const off = JSON.parse(sent.at(-1)!.payload);
    expect(off.badge).toBeUndefined();
    expect(off.notification.app_badge).toBeUndefined();
    await api(ctx, noa, 'PUT', '/v1/me/settings', { appBadge: true, discreetNotifications: true });
    await ctx.redis.flushdb();
    await sendPush(withApp(), { userId: noa.id, kind: 'checkin', matchId: noa.id });
    const discreet = JSON.parse(sent.at(-1)!.payload);
    expect(discreet.badge).toBeUndefined();
    expect(discreet.actions).toBeUndefined();
    expect(discreet.title).not.toBe('NexaHeart');
  });

  it('the same rules: a muted chat sends nothing, a call still rings, urgently and briefly', async () => {
    await api(ctx, noa, 'PUT', `/v1/matches/${matchId}/prefs`, { muted: true });
    expect(await sendPush(context(), { userId: noa.id, kind: 'message', matchId })).toBe('muted');
    expect(sent).toHaveLength(0);
    expect(await sendPush(context(), { userId: noa.id, kind: 'call', matchId })).toBe('sent');
    expect(sent[0]!.options).toMatchObject({ urgency: 'high', TTL: 60 });
  });

  it('a browser the push service says is gone is forgotten', async () => {
    answer = 410;
    expect(await sendPush(context(), { userId: noa.id, kind: 'match', matchId })).toBe('sent');
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT 1 FROM web_push_subscriptions WHERE user_id = $1',
      [noa.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('never posts outside the allow-list, even to an address already in the database', async () => {
    await ctx.services.dbHandle.pool.query(
      `INSERT INTO web_push_subscriptions (endpoint, user_id, p256dh, auth) VALUES ($1, $2, $3, $4)`,
      ['https://169.254.169.254/latest', noa.id, keys.p256dh, keys.auth],
    );
    await sendPush(context(), { userId: noa.id, kind: 'match', matchId });
    expect(sent.map((x) => x.endpoint)).toEqual([fcm('noa')]);
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT endpoint FROM web_push_subscriptions WHERE user_id = $1',
      [noa.id],
    );
    expect(rows.map((r: { endpoint: string }) => r.endpoint)).toEqual([fcm('noa')]);
  });
});

describe.skipIf(!integrationEnabled)(
  'notifications in the web app, not set up (integration)',
  () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await setupIntegration({ webPushKey: '' });
    });
    afterAll(async () => teardown(ctx));

    it('says so, and keeps nothing', async () => {
      await resetState(ctx);
      const noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      expect((await ctx.app.inject({ method: 'GET', url: '/v1/push/web' })).json()).toEqual({
        enabled: false,
        publicKey: null,
      });
      const res = await api(ctx, noa, 'POST', '/v1/me/web-push', { endpoint: fcm(1), keys });
      expect(res.statusCode).toBe(503);
    });
  },
);
