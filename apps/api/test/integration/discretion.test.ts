// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const HELP = 'Legal aid: +972-3-000-0000 (Sun–Thu)\nEmergency: 100';

describe.skipIf(!integrationEnabled)('discretion, phase 67a (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  const card = async () => (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json();

  it('hide my distance: no distance, "near you" or "visiting" for others', async () => {
    const before = await card();
    expect(before.distance).not.toBeNull();
    expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json()).toMatchObject({
      hideDistance: false,
      discreetNotifications: false,
    });
    expect((await api(ctx, noa, 'PUT', '/v1/me/settings', { hideDistance: true })).statusCode).toBe(
      200,
    );
    const after = await card();
    expect(after.distance).toBeNull();
    expect(after.visiting).toBeNull();
    expect(after.reasons).not.toContain('nearby');
    const deck = (await api(ctx, dan, 'GET', '/v1/discover?limit=20')).json().profiles;
    const her = deck.find((p: { id: string }) => p.id === noa.id);
    expect(her?.distance ?? null).toBeNull();
    expect(her?.reasons ?? []).not.toContain('nearby');
    // Dan, who doesn't hide, still shows his to her.
    expect((await api(ctx, noa, 'GET', `/v1/profiles/${dan.id}`)).json().distance).not.toBeNull();
  });

  it('discreet notifications: saved, in "Download my data"', async () => {
    await api(ctx, noa, 'PUT', '/v1/me/settings', {
      discreetNotifications: true,
      hideDistance: true,
    });
    const { rows } = await q('SELECT discreet_notifications FROM preferences WHERE user_id = $1', [
      noa.id,
    ]);
    expect(rows[0].discreet_notifications).toBe(true);
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.preferences).toMatchObject({ hideDistance: true, discreetNotifications: true });
  });

  it('local help: admins write it, everyone reads it, plain text only', async () => {
    const email = 'help-admin@example.test';
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
    const admin = { cookie } as Member;
    const info = async () =>
      (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json().community;
    expect((await info()).safetyResources).toBeNull();
    expect(
      (await api(ctx, admin, 'PATCH', '/v1/admin/instance', { safetyResources: HELP })).statusCode,
    ).toBe(200);
    expect((await info()).safetyResources).toBe(HELP);
    expect(
      (await api(ctx, admin, 'PATCH', '/v1/admin/instance', { safetyResources: '<a href=x>' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await api(ctx, noa, 'PATCH', '/v1/admin/instance', { safetyResources: 'x' })).statusCode,
    ).toBe(403);
    await api(ctx, admin, 'PATCH', '/v1/admin/instance', { safetyResources: null });
    expect((await info()).safetyResources).toBeNull();
  });
});
