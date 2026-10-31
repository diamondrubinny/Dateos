// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { FederationHeader, type FederationIdentity } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  generateFederationKeys,
  newNonce,
  signParts,
  verifyParts,
} from '../../src/lib/federation-sign.js';
import { totp } from '../../src/lib/totp.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const PARTNER = 'https://api.partner.example.test';
const SELF = 'http://localhost:4000';

/**
 * Another community, faked: it publishes its identity, checks every signed request it receives
 * with our published key, and can sign requests to us with its own key.
 */
function fakePartner() {
  const keys = generateFederationKeys();
  const received: { method: string; path: string; body: string; valid: boolean }[] = [];
  let ourKey = '';
  const identity: FederationIdentity = {
    version: 1,
    name: 'Rainbow Haifa',
    url: PARTNER,
    publicKey: keys.publicKey,
    contact: 'team@partner.example.test',
    privacyUrl: 'https://partner.example.test/privacy',
  };
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== PARTNER) throw new Error(`unexpected host ${url.origin}`);
    if (url.pathname === '/.well-known/nexaheart') {
      return new Response(JSON.stringify(identity), { status: 200 });
    }
    const h = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : '';
    const parts = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      origin: h.get(FederationHeader.Origin) ?? '',
      date: h.get(FederationHeader.Date) ?? '',
      nonce: h.get(FederationHeader.Nonce) ?? '',
      body,
    };
    const valid =
      parts.origin === SELF && verifyParts(ourKey, parts, h.get(FederationHeader.Signature) ?? '');
    received.push({ method: parts.method, path: parts.path, body, valid });
    return new Response(JSON.stringify({ ok: true }), { status: valid ? 200 : 401 });
  }) as typeof fetch;
  return {
    keys,
    identity,
    received,
    fetchImpl,
    learn(key: string) {
      ourKey = key;
    },
  };
}

describe.skipIf(!integrationEnabled)('communities that connect: foundation (integration)', () => {
  let ctx: TestContext;
  let admin: string;
  let n = 0;
  let partner = fakePartner();
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
  const asStaff = (cookie: string, method: 'GET' | 'POST', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  /** The partner signs a request to us (optionally tampered with). */
  function fromPartner(
    method: 'GET' | 'POST',
    path: string,
    payload: object | null,
    over: Partial<{ date: string; nonce: string; origin: string; body: string }> = {},
  ) {
    const body = payload ? JSON.stringify(payload) : '';
    const parts = {
      method,
      path,
      origin: over.origin ?? PARTNER,
      date: over.date ?? new Date(ctx.clock.value).toISOString(),
      nonce: over.nonce ?? newNonce(),
      body,
    };
    const signature = signParts(partner.keys.privateKey, parts);
    return ctx.app.inject({
      method,
      url: path,
      headers: {
        ...(payload ? { 'content-type': 'application/json' } : {}),
        [FederationHeader.Origin]: parts.origin,
        [FederationHeader.Date]: parts.date,
        [FederationHeader.Nonce]: parts.nonce,
        [FederationHeader.Signature]: signature,
      },
      ...(payload ? { payload: over.body ?? body } : {}),
    });
  }
  const list = async () => (await asStaff(admin, 'GET', '/v1/admin/partners')).json();

  beforeAll(async () => {
    ctx = await setupIntegration({
      federation: true,
      // Every outgoing request goes to the fake partner.
      fetch: ((input: URL | string, init?: RequestInit) =>
        partner.fetchImpl(input, init)) as typeof fetch,
    });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    partner = fakePartner();
    admin = await staff('admin');
    const self = await ctx.app.inject({ method: 'GET', url: '/.well-known/nexaheart' });
    partner.learn(self.json().publicKey);
  });

  it('publishes an identity with a stable key, its private half sealed', async () => {
    const first = (await ctx.app.inject({ method: 'GET', url: '/.well-known/nexaheart' })).json();
    expect(first).toMatchObject({
      version: 1,
      url: SELF,
      privacyUrl: expect.stringMatching(/\/privacy$/),
    });
    const again = (await ctx.app.inject({ method: 'GET', url: '/.well-known/nexaheart' })).json();
    expect(again.publicKey).toBe(first.publicKey);
    const { rows } = await q('SELECT private_key_sealed FROM federation_keys');
    expect(rows).toHaveLength(1);
    expect(rows[0].private_key_sealed).not.toContain('PRIVATE KEY');
  });

  it('invites a community: agreement confirmed, signed, then active when they accept', async () => {
    // The agreement must be confirmed ⚖️.
    expect((await asStaff(admin, 'POST', '/v1/admin/partners', { url: PARTNER })).statusCode).toBe(
      400,
    );
    const mod = await staff('moderator');
    expect(
      (await asStaff(mod, 'POST', '/v1/admin/partners', { url: PARTNER, agreementConfirmed: true }))
        .statusCode,
    ).toBe(403);
    expect((await asStaff(mod, 'GET', '/v1/admin/partners')).statusCode).toBe(200);

    const invited = await asStaff(admin, 'POST', '/v1/admin/partners', {
      url: `${PARTNER}/some/path`,
      agreementConfirmed: true,
    });
    expect(invited.statusCode).toBe(200);
    expect(invited.json().partners[0]).toMatchObject({
      url: PARTNER,
      name: 'Rainbow Haifa',
      status: 'invited_out',
      contact: 'team@partner.example.test',
    });
    // The partner got a signed invitation it could verify with our published key.
    expect(partner.received).toEqual([
      expect.objectContaining({ method: 'POST', path: '/v1/federation/invitations', valid: true }),
    ]);
    // Inviting twice is refused.
    expect(
      (
        await asStaff(admin, 'POST', '/v1/admin/partners', {
          url: PARTNER,
          agreementConfirmed: true,
        })
      ).statusCode,
    ).toBe(409);

    // They accept (signed); we're connected.
    expect((await fromPartner('POST', '/v1/federation/accept', {})).statusCode).toBe(200);
    const partners = (await list()).partners;
    expect(partners[0]).toMatchObject({ status: 'active', activatedAt: expect.any(String) });

    // A test ping works both ways.
    const tested = (
      await asStaff(admin, 'POST', `/v1/admin/partners/${partners[0].id}/test`)
    ).json();
    expect(tested.partners[0].lastError).toBeNull();
    expect(partner.received.at(-1)).toMatchObject({ path: '/v1/federation/ping', valid: true });
    expect((await fromPartner('GET', '/v1/federation/ping', null)).statusCode).toBe(200);
  });

  it('receives an invitation for the admin to accept, and ends a partnership both ways', async () => {
    expect(
      (await fromPartner('POST', '/v1/federation/invitations', { version: 1 })).statusCode,
    ).toBe(200);
    const [p] = (await list()).partners;
    expect(p).toMatchObject({ status: 'invited_in', name: 'Rainbow Haifa' });
    // Not connected yet: their pings are refused.
    expect((await fromPartner('GET', '/v1/federation/ping', null)).statusCode).toBe(403);
    expect((await asStaff(admin, 'POST', `/v1/admin/partners/${p.id}/accept`, {})).statusCode).toBe(
      400,
    );
    const accepted = await asStaff(admin, 'POST', `/v1/admin/partners/${p.id}/accept`, {
      agreementConfirmed: true,
    });
    expect(accepted.json().partners[0].status).toBe('active');
    expect(partner.received.at(-1)).toMatchObject({ path: '/v1/federation/accept', valid: true });

    const ended = await asStaff(admin, 'POST', `/v1/admin/partners/${p.id}/end`);
    expect(ended.json().partners[0].status).toBe('ended');
    expect(partner.received.at(-1)).toMatchObject({ path: '/v1/federation/end', valid: true });
    // After the end, their requests are no longer accepted.
    expect((await fromPartner('GET', '/v1/federation/ping', null)).statusCode).toBe(401);

    const { rows } = await q(
      `SELECT action, target_id FROM audit_logs WHERE action LIKE 'federation.%' ORDER BY created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'federation.invited_in',
      'federation.accept',
      'federation.end',
    ]);
    expect(rows.every((r) => r.target_id === PARTNER)).toBe(true);
  });

  it('phase 73a: our country goes out; no partners in a country at risk; existing ones flagged', async () => {
    const settings = (payload: object) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/v1/admin/instance',
        headers: { cookie: admin },
        payload,
      });
    expect((await settings({ communityCountry: 'Israel' })).statusCode).toBe(400);
    const saved = await settings({ communityCountry: 'IL', riskCountries: ['XA'] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ communityCountry: 'IL', partnerCards: 'full' });
    const self = (await ctx.app.inject({ method: 'GET', url: '/.well-known/nexaheart' })).json();
    expect(self.country).toBe('IL');

    // A community that says it's in a country at risk: inviting it is refused, with the reason.
    partner.identity.country = 'XA';
    const refused = await asStaff(admin, 'POST', '/v1/admin/partners', {
      url: PARTNER,
      agreementConfirmed: true,
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.message).toContain('XA');
    expect((await list()).partners).toEqual([]);
    expect(partner.received).toEqual([]);

    // It invites us: kept, flagged, and accepting it is refused.
    await fromPartner('POST', '/v1/federation/invitations', { version: 1 });
    const [p] = (await list()).partners;
    expect(p).toMatchObject({ status: 'invited_in', country: 'XA', atRisk: true });
    const accept = await asStaff(admin, 'POST', `/v1/admin/partners/${p.id}/accept`, {
      agreementConfirmed: true,
    });
    expect(accept.statusCode).toBe(422);
    expect((await list()).partners[0].status).toBe('invited_in');

    // It says it moved (or wasn't there): accepting checks again and connects.
    partner.identity.country = 'FR';
    const ok = await asStaff(admin, 'POST', `/v1/admin/partners/${p.id}/accept`, {
      agreementConfirmed: true,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().partners[0]).toMatchObject({ status: 'active', country: 'FR', atRisk: false });

    // Now on our list: the partnership isn't ended, but it's flagged (after a test, it says so).
    await settings({ riskCountries: ['XA', 'FR'] });
    expect((await list()).partners[0]).toMatchObject({ status: 'active', atRisk: true });
    partner.identity.country = 'DE';
    const tested = (await asStaff(admin, 'POST', `/v1/admin/partners/${p.id}/test`)).json();
    expect(tested.partners[0]).toMatchObject({ country: 'DE', atRisk: false });
    // An older partner without a country is never refused for it.
    delete partner.identity.country;
    await asStaff(admin, 'POST', `/v1/admin/partners/${p.id}/test`);
    expect((await list()).partners[0]).toMatchObject({ country: null, atRisk: false });
  });

  it('refuses unsigned, tampered, old, replayed and self-signed requests', async () => {
    await fromPartner('POST', '/v1/federation/invitations', { version: 1 });
    const [p] = (await list()).partners;
    await asStaff(admin, 'POST', `/v1/admin/partners/${p.id}/accept`, { agreementConfirmed: true });

    expect((await ctx.app.inject({ method: 'GET', url: '/v1/federation/ping' })).statusCode).toBe(
      401,
    );
    // The body was changed after signing.
    expect(
      (await fromPartner('POST', '/v1/federation/end', { a: 1 }, { body: '{"a":2}' })).statusCode,
    ).toBe(401);
    // Six minutes old.
    const old = new Date(ctx.clock.value - 6 * 60_000).toISOString();
    expect((await fromPartner('GET', '/v1/federation/ping', null, { date: old })).statusCode).toBe(
      401,
    );
    // The same nonce twice.
    const nonce = newNonce();
    expect((await fromPartner('GET', '/v1/federation/ping', null, { nonce })).statusCode).toBe(200);
    expect((await fromPartner('GET', '/v1/federation/ping', null, { nonce })).statusCode).toBe(401);
    // Claiming to be us.
    expect(
      (await fromPartner('GET', '/v1/federation/ping', null, { origin: SELF })).statusCode,
    ).toBe(401);
    // Another key claiming to be the partner.
    const impostor = generateFederationKeys();
    const parts = {
      method: 'GET',
      path: '/v1/federation/ping',
      origin: PARTNER,
      date: new Date(ctx.clock.value).toISOString(),
      nonce: newNonce(),
      body: '',
    };
    const forged = await ctx.app.inject({
      method: 'GET',
      url: parts.path,
      headers: {
        [FederationHeader.Origin]: parts.origin,
        [FederationHeader.Date]: parts.date,
        [FederationHeader.Nonce]: parts.nonce,
        [FederationHeader.Signature]: signParts(impostor.privateKey, parts),
      },
    });
    expect(forged.statusCode).toBe(401);
    // Inviting this server itself is refused.
    expect(
      (await asStaff(admin, 'POST', '/v1/admin/partners', { url: SELF, agreementConfirmed: true }))
        .statusCode,
    ).toBe(422);
  });

  it('caps invitations waiting for the admin', async () => {
    for (let i = 0; i < 20; i += 1) {
      await q(
        `INSERT INTO federation_partners (url, name, public_key, status) VALUES ($1, 'x', 'k', 'invited_in')`,
        [`https://spam-${i}.example.test`],
      );
    }
    expect(
      (await fromPartner('POST', '/v1/federation/invitations', { version: 1 })).statusCode,
    ).toBe(429);
  });

  it('removes a failed invitation and reports why', async () => {
    partner.fetchImpl = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    const res = await asStaff(admin, 'POST', '/v1/admin/partners', {
      url: PARTNER,
      agreementConfirmed: true,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toContain('isn’t a NexaHeart community');
    expect((await list()).partners).toEqual([]);
  });
});

describe.skipIf(!integrationEnabled)(
  'communities that connect: off by default (integration)',
  () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await setupIntegration();
    });
    afterAll(async () => teardown(ctx));

    it('publishes nothing and accepts nothing', async () => {
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/.well-known/nexaheart' })).statusCode,
      ).toBe(404);
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/federation/invitations',
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(503);
    });
  },
);
