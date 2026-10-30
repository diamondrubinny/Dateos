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

describe.skipIf(!integrationEnabled)(
  'gender identity and pronouns, phase 62a (integration)',
  () => {
    let ctx: TestContext;
    let noa: Member;
    let dan: Member;
    let eve: Member;
    let admin: Member;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);
    beforeAll(async () => {
      ctx = await setupIntegration();
    });
    afterAll(async () => teardown(ctx));
    beforeEach(async () => {
      await resetState(ctx);
      noa = await createMember(ctx, { name: 'Noa', gender: 'nonbinary', interestedIn: ['man'] });
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['nonbinary'] });
      eve = await createMember(ctx, { name: 'Eve', gender: 'man', interestedIn: ['nonbinary'] });
      // An admin with two-factor sign-in, for the community's settings.
      const email = 'identity-admin@example.test';
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
      admin = { ...noa, cookie };
    });

    const settings = (body: Record<string, unknown>) =>
      api(ctx, admin, 'PATCH', '/v1/admin/instance', body);
    const setIdentity = (m: Member, body: Record<string, unknown>) =>
      api(ctx, m, 'PUT', '/v1/me/identity', body);
    const card = async (viewer: Member, target: Member) =>
      (await api(ctx, viewer, 'GET', `/v1/profiles/${target.id}`)).json();
    const match = async () => {
      await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    };

    it('the community offers the longer list and pronouns by default, not own words', async () => {
      const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
      expect(info.identity).toEqual({
        vocabulary: 'extended',
        customGender: false,
        pronouns: true,
      });
      const ok = await setIdentity(noa, {
        genderIdentity: 'genderqueer',
        genderCustom: null,
        pronouns: 'neutral',
      });
      expect(ok.statusCode).toBe(200);
      const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
      expect(me.identity).toEqual({
        genderIdentity: 'genderqueer',
        genderCustom: null,
        pronouns: 'neutral',
        visibility: 'matches', // the default
      });
      const own = await setIdentity(noa, {
        genderIdentity: null,
        genderCustom: 'Butch',
        pronouns: null,
      });
      expect(own.statusCode).toBe(400); // own words are off by default
    });

    it('matches only (the default): a stranger doesn’t see it, a match does', async () => {
      await setIdentity(noa, {
        genderIdentity: 'nonbinary',
        genderCustom: null,
        pronouns: 'neutral',
      });
      expect((await card(eve, noa)).identity ?? null).toBeNull();
      expect((await card(dan, noa)).identity ?? null).toBeNull(); // not a match yet
      await match();
      expect((await card(dan, noa)).identity).toEqual({
        genderIdentity: 'nonbinary',
        genderCustom: null,
        pronouns: 'neutral',
      });
      // The member's own preview shows it too.
      expect((await api(ctx, noa, 'GET', '/v1/me/preview')).json().profile.identity).toMatchObject({
        genderIdentity: 'nonbinary',
      });
      // "Everyone" shows it to strangers.
      await setIdentity(noa, {
        genderIdentity: 'nonbinary',
        genderCustom: null,
        pronouns: 'neutral',
        visibility: 'everyone',
      });
      expect((await card(eve, noa)).identity).toMatchObject({ pronouns: 'neutral' });
    });

    it('own words where the community allows them: plain letters, checked, not with a list key', async () => {
      expect((await settings({ identityCustom: true })).statusCode).toBe(200);
      for (const bad of ['<b>x</b>', 'a', 'x'.repeat(31), '1234', 'http://x.example']) {
        const res = await setIdentity(noa, {
          genderIdentity: null,
          genderCustom: bad,
          pronouns: null,
        });
        expect(res.statusCode, bad).toBe(400);
      }
      const both = await setIdentity(noa, {
        genderIdentity: 'nonbinary',
        genderCustom: 'Genderflux',
        pronouns: null,
      });
      expect(both.statusCode).toBe(400);
      const ok = await setIdentity(noa, {
        genderIdentity: null,
        genderCustom: 'קווירית / Queer',
        pronouns: 'any',
        visibility: 'everyone',
      });
      expect(ok.statusCode).toBe(200);
      expect((await card(eve, noa)).identity).toEqual({
        genderIdentity: null,
        genderCustom: 'קווירית / Queer',
        pronouns: 'any',
      });
    });

    it('turning an option off hides it at once (kept, so turning it back on restores it)', async () => {
      await setIdentity(noa, {
        genderIdentity: 'trans_woman',
        genderCustom: null,
        pronouns: 'feminine',
        visibility: 'everyone',
      });
      await settings({ identityVocabulary: 'basic' });
      expect((await card(eve, noa)).identity).toEqual({
        genderIdentity: null,
        genderCustom: null,
        pronouns: 'feminine',
      });
      await settings({ identityPronouns: false });
      expect((await card(eve, noa)).identity ?? null).toBeNull();
      // The short list refuses identity keys from now on.
      const refused = await setIdentity(dan, {
        genderIdentity: 'man',
        genderCustom: null,
        pronouns: null,
      });
      expect(refused.statusCode).toBe(400);
      await settings({ identityVocabulary: 'extended', identityPronouns: true });
      expect((await card(eve, noa)).identity).toMatchObject({ genderIdentity: 'trans_woman' });
    });

    it('never in matching, never to partners; in "Download my data"; deleted with the account', async () => {
      await setIdentity(noa, {
        genderIdentity: 'agender',
        genderCustom: null,
        pronouns: 'neutral',
        visibility: 'everyone',
      });
      // Discover is unchanged: the matching gender is still what decides.
      const deck = (await api(ctx, dan, 'GET', '/v1/discover?limit=20')).json();
      expect(deck.profiles.map((p: { id: string }) => p.id)).toContain(noa.id);
      const zip = await api(ctx, noa, 'GET', '/v1/me/export');
      const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
      expect(data.about).toMatchObject({
        genderIdentity: 'agender',
        pronouns: 'neutral',
        identityVisibility: 'everyone',
      });
      await api(ctx, noa, 'DELETE', '/v1/me');
      const { rows } = await q('SELECT count(*)::int AS n FROM profile_about WHERE user_id = $1', [
        noa.id,
      ]);
      expect(rows[0].n).toBe(0);
    });
  },
);
