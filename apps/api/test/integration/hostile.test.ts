// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import sharp from 'sharp';
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

const HAIFA = 294801; // IL

describe.skipIf(!integrationEnabled)(
  'discreet app and countries at risk, phase 67b (integration)',
  () => {
    let ctx: TestContext;
    let noa: Member;
    let admin: Member;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    beforeAll(async () => {
      ctx = await setupIntegration();
    });
    afterAll(async () => teardown(ctx));
    beforeEach(async () => {
      await resetState(ctx);
      noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      const email = 'hostile-admin@example.test';
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
    const get = (url: string) => ctx.app.inject({ method: 'GET', url });
    const paused = async () =>
      (await q('SELECT paused_at, paused_until FROM "user" WHERE id = $1', [noa.id])).rows[0];

    it('a discreet app: its name everywhere, plain icons, never the logo', async () => {
      await settings({ name: 'Rainbow Club' });
      expect((await settings({ discreetName: 'Notes' })).statusCode).toBe(200);
      ctx.services.instance.invalidate();
      expect((await get('/v1/instance')).json().discreetName).toBe('Notes');
      const manifest = (await get('/v1/instance/manifest.webmanifest')).json();
      expect(manifest).toMatchObject({ name: 'Notes', short_name: 'Notes', description: '' });
      expect(JSON.stringify(manifest)).not.toContain('Rainbow');
      const icon = await get('/v1/instance/icons/icon-192.png');
      expect(icon.statusCode).toBe(200); // made here, not a redirect to the built-in heart
      const { width, height } = await sharp(icon.rawPayload).metadata();
      expect([width, height]).toEqual([192, 192]);
      const { dominant } = await sharp(icon.rawPayload).stats();
      expect(dominant).toMatchObject({ r: expect.any(Number) });
      expect(Math.abs(dominant.r - dominant.b)).toBeLessThan(40); // grey, not the brand colour
      expect((await settings({ discreetName: '<b>' })).statusCode).toBe(400);
      await settings({ discreetName: null });
      ctx.services.instance.invalidate();
      expect((await get('/v1/instance/manifest.webmanifest')).json().name).toBe('Rainbow Club');
    });

    it('countries at risk: ISO codes only, chosen by the admins', async () => {
      for (const bad of [['il'], ['ISR'], ['IL', 'IL']]) {
        expect((await settings({ riskCountries: bad })).statusCode).toBe(400);
      }
      expect((await settings({ riskCountries: ['IL', 'AE'] })).statusCode).toBe(200);
      ctx.services.instance.invalidate();
      expect((await get('/v1/instance')).json().community.riskCountries).toEqual(['IL', 'AE']);
      expect(
        (await api(ctx, noa, 'PATCH', '/v1/admin/instance', { riskCountries: [] })).statusCode,
      ).toBe(403);
    });

    it('a trip to one hides me from new people until it ends; elsewhere it doesn’t', async () => {
      // Not at risk: nothing changes.
      const plain = (
        await api(ctx, noa, 'PUT', '/v1/me/travel', { cityId: HAIFA, days: 5 })
      ).json();
      expect(plain.travel).toMatchObject({ atRisk: false, hidden: false });
      expect((await paused()).paused_at).toBeNull();
      await api(ctx, noa, 'DELETE', '/v1/me/travel');

      await settings({ riskCountries: ['IL'] });
      const trip = (await api(ctx, noa, 'PUT', '/v1/me/travel', { cityId: HAIFA, days: 5 })).json();
      expect(trip.travel).toMatchObject({ atRisk: true, hidden: true });
      const p = await paused();
      expect(p.paused_at).not.toBeNull();
      expect(new Date(p.paused_until).toISOString()).toBe(trip.travel.until);
      expect((await api(ctx, noa, 'GET', '/v1/me/travel')).json().travel).toMatchObject({
        atRisk: true,
        hidden: true,
      });
      // Ending the trip early ends the hiding it started.
      await api(ctx, noa, 'DELETE', '/v1/me/travel');
      expect((await paused()).paused_at).toBeNull();
    });

    it('the member can choose not to hide; a break they chose stays', async () => {
      await settings({ riskCountries: ['IL'] });
      const shown = (
        await api(ctx, noa, 'PUT', '/v1/me/travel', {
          cityId: HAIFA,
          days: 5,
          hideWhileThere: false,
        })
      ).json();
      expect(shown.travel).toMatchObject({ atRisk: true, hidden: false });
      expect((await paused()).paused_at).toBeNull();
      await api(ctx, noa, 'DELETE', '/v1/me/travel');
      // An open-ended break, then a trip there and back: still on a break.
      expect(
        (await api(ctx, noa, 'PUT', '/v1/me/pause', { duration: 'indefinite' })).statusCode,
      ).toBe(200);
      await api(ctx, noa, 'PUT', '/v1/me/travel', { cityId: HAIFA, days: 5 });
      expect((await paused()).paused_until).toBeNull();
      await api(ctx, noa, 'DELETE', '/v1/me/travel');
      const after = await paused();
      expect(after.paused_at).not.toBeNull();
      expect(after.paused_until).toBeNull();
    });
  },
);
