// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { FederationHeader } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateFederationKeys, newNonce, signParts } from '../../src/lib/federation-sign.js';
import { FEDERATION_KEY_PATH } from '../../src/modules/federation/service.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';
import { A_URL, B_URL, bridge } from './two-servers.js';

describe.skipIf(!integrationEnabled)('partner communities: key rotation (integration)', () => {
  let a: TestContext;
  let b: TestContext;
  let bDown = false;
  const qb = (sql: string, params: unknown[] = []) => b.services.dbHandle.pool.query(sql, params);
  let adminA: string;
  let partnerAtA: string;
  let partnerAtB: string;

  beforeAll(async () => {
    const toB = bridge(B_URL, () => b);
    a = await setupIntegration({
      federation: true,
      apiUrl: A_URL,
      fetch: (async (input: URL | string, init?: RequestInit) => {
        if (bDown) throw new Error('connect ECONNREFUSED');
        return toB(input, init);
      }) as typeof fetch,
    });
    b = await setupIntegration({
      federation: true,
      second: { suffix: 'b', redisDb: 14, apiUrl: B_URL },
      fetch: bridge(A_URL, () => a),
    });
  });
  afterAll(async () => {
    if (a) await teardown(a);
    if (b) await teardown(b);
  });

  const idOf = async (ctx: TestContext, cookie: string) =>
    (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json().user
      .id as string;

  beforeEach(async () => {
    bDown = false;
    await resetState(a);
    await resetState(b);
    adminA = await idOf(a, await signIn(a, 'admin-a@example.test'));
    const adminB = await idOf(b, await signIn(b, 'admin-b@example.test'));
    await a.services.federation.invite(adminA, B_URL);
    partnerAtB = (await b.services.federation.list()).partners[0]!.id;
    await b.services.federation.accept(adminB, partnerAtB);
    partnerAtA = (await a.services.federation.list()).partners[0]!.id;
  });

  const storedAtB = async () =>
    (await qb('SELECT public_key FROM federation_partners')).rows[0].public_key as string;
  const pingWorks = async () =>
    (await a.services.federation.test(adminA, partnerAtA)).partners[0]!.lastError === null;

  it('rotates the key; the partner learns it, signed with the old key, and keeps working', async () => {
    const before = (await a.services.federation.identity()).publicKey;
    expect(await storedAtB()).toBe(before);
    const listed = await a.services.federation.rotateKey(adminA);
    const after = listed.self!.publicKey;
    expect(after).not.toBe(before);
    expect(listed.key).toMatchObject({ waiting: 0 });
    expect(listed.key!.rotatedAt).not.toBeNull();
    // B now trusts the new key, and both directions still work.
    expect(await storedAtB()).toBe(after);
    expect(await pingWorks()).toBe(true);
    const back = await b.services.federation.test(
      (await qb(`SELECT id FROM "user" LIMIT 1`)).rows[0].id,
      partnerAtB,
    );
    expect(back.partners[0]!.lastError).toBeNull();
    const audits = await qb(
      `SELECT action FROM audit_logs WHERE action = 'federation.key_changed'`,
    );
    expect(audits.rowCount).toBe(1);
  });

  it('a partner that can’t be reached gets the new key later, signed with the old one', async () => {
    const before = await storedAtB();
    bDown = true;
    const listed = await a.services.federation.rotateKey(adminA);
    expect(listed.key!.waiting).toBe(1);
    // Rotating again before everyone has the new key is refused.
    await expect(a.services.federation.rotateKey(adminA)).rejects.toThrow(/haven’t received/);
    bDown = false;
    expect(await storedAtB()).toBe(before);
    // Until B has the new key, A's new signatures are refused there.
    expect(await pingWorks()).toBe(false);
    a.clock.value += 61_000;
    b.clock.value = a.clock.value;
    expect(await a.services.federation.drainOutbox()).toMatchObject({ sent: 1 });
    expect(await storedAtB()).toBe((await a.services.federation.identity()).publicKey);
    expect(await pingWorks()).toBe(true);
    expect((await a.services.federation.list()).key!.waiting).toBe(0);
  });

  it('after a week the old key is gone: a waiting announcement is given up', async () => {
    bDown = true;
    await a.services.federation.rotateKey(adminA);
    a.clock.value += 7 * 86_400_000 + 1;
    bDown = false;
    expect(await a.services.federation.drainOutbox()).toMatchObject({ sent: 0, dropped: 1 });
    // The partnership has to be renewed by hand; the dashboard shows the failed ping.
    expect(await pingWorks()).toBe(false);
  });

  it('refuses a new key without proof, or announced by someone else', async () => {
    const mallory = generateFederationKeys();
    const body = JSON.stringify({
      publicKey: mallory.publicKey,
      rotatedAt: new Date(b.clock.value).toISOString(),
      proof: 'x'.repeat(88),
    });
    // Signed by an unknown key: refused before the proof is even looked at.
    const date = new Date(b.clock.value).toISOString();
    const nonce = newNonce();
    const parts = { method: 'POST', path: FEDERATION_KEY_PATH, origin: A_URL, date, nonce, body };
    const res = await b.app.inject({
      method: 'POST',
      url: FEDERATION_KEY_PATH,
      headers: {
        'content-type': 'application/json',
        [FederationHeader.Origin]: A_URL,
        [FederationHeader.Date]: date,
        [FederationHeader.Nonce]: nonce,
        [FederationHeader.Signature]: signParts(mallory.privateKey, parts),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    // Signed by A's real key but with a proof that doesn't match the new key: refused.
    await expect(
      a.services.federation.send(B_URL, 'POST', FEDERATION_KEY_PATH, JSON.parse(body)),
    ).rejects.toThrow(/401/);
    expect(await storedAtB()).toBe((await a.services.federation.identity()).publicKey);
  });
});
