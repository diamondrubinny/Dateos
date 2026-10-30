// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { RELIGION_CONSENT_VERSION } from '@nexaheart/shared';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)(
  'marriage, history and the faith module, phase 62b (integration)',
  () => {
    let ctx: TestContext;
    let noa: Member;
    let dan: Member;
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
      dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      const email = 'faith-admin@example.test';
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
    const consent = (m: Member, granted: boolean) =>
      api(ctx, m, 'PUT', '/v1/me/consents', {
        consents: [{ kind: 'religion', granted, version: RELIGION_CONSENT_VERSION }],
      });
    const setFaith = (m: Member, body: Record<string, unknown>) =>
      api(ctx, m, 'PUT', '/v1/me/faith', { observance: {}, stream: null, ...body });
    const dealbreakers = (m: Member, body: Record<string, unknown>) =>
      api(ctx, m, 'PUT', '/v1/me/dealbreakers', {
        smokingOk: [],
        childrenOk: [],
        religionOk: [],
        heightMin: null,
        heightMax: null,
        ...body,
      });

    it('marriage: chosen like any intention, offered unless the community narrows the list', async () => {
      const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
      expect(info.community).toMatchObject({
        intentions: ['long_term', 'marriage', 'short_term', 'open', 'friends', 'unsure'],
        faith: false,
      });
      expect(
        (await api(ctx, noa, 'PATCH', '/v1/me/profile', { intention: 'marriage' })).statusCode,
      ).toBe(200);
      expect((await api(ctx, noa, 'GET', '/v1/me')).json().profile.intention).toBe('marriage');
      // A community that offers only marriage and long-term.
      expect((await settings({ intentionsOffered: ['marriage', 'long_term'] })).statusCode).toBe(
        200,
      );
      expect((await settings({ intentionsOffered: [] })).statusCode).toBe(400);
      const refused = await api(ctx, dan, 'PATCH', '/v1/me/profile', { intention: 'short_term' });
      expect(refused.statusCode).toBe(400);
      // A member keeps a choice the community later removed (they're not forced to change).
      await settings({ intentionsOffered: ['long_term'] });
      expect(
        (await api(ctx, noa, 'PATCH', '/v1/me/profile', { intention: 'marriage' })).statusCode,
      ).toBe(200);
    });

    it('relationship history is an ordinary, optional "about me" field', async () => {
      const about = {
        interests: [],
        children: 'have_no_more',
        smoking: null,
        drinking: null,
        heightCm: null,
        religion: null,
        openingQuestion: null,
        relationshipHistory: 'divorced',
      };
      expect((await api(ctx, noa, 'PUT', '/v1/me/about', about)).statusCode).toBe(200);
      expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().about).toMatchObject({
        relationshipHistory: 'divorced',
      });
      const bad = await api(ctx, noa, 'PUT', '/v1/me/about', {
        ...about,
        relationshipHistory: 'its_complicated',
      });
      expect(bad.statusCode).toBe(400);
    });

    it('the faith module: off by default, then with the religion consent and fitting answers only', async () => {
      const answer = {
        faith: 'jewish',
        stream: 'dati_leumi',
        observance: { shabbat: 'yes', kashrut: 'yes' },
      };
      expect((await consent(noa, true)).statusCode).toBe(200);
      expect((await setFaith(noa, answer)).statusCode).toBe(400); // module off
      await settings({ faithModule: true });
      await consent(noa, false);
      expect((await setFaith(noa, answer)).statusCode).toBe(403); // no consent
      await consent(noa, true);
      // A stream or question that doesn't belong to the faith.
      expect((await setFaith(noa, { ...answer, stream: 'sunni' })).statusCode).toBe(400);
      expect((await setFaith(noa, { ...answer, observance: { halal: 'yes' } })).statusCode).toBe(
        400,
      );
      expect((await setFaith(noa, answer)).statusCode).toBe(200);
      expect((await api(ctx, noa, 'GET', '/v1/me')).json().faith).toEqual(answer);
      expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().faith).toEqual(answer);
      // Turning the module off hides it at once (kept).
      await settings({ faithModule: false });
      expect(
        (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().faith ?? null,
      ).toBeNull();
      await settings({ faithModule: true });
      expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().faith).toEqual(answer);
    });

    it('faith and stream dealbreakers: both ways, a missing answer passes, only while the module is on', async () => {
      await settings({ faithModule: true });
      await consent(noa, true);
      await consent(dan, true);
      await setFaith(noa, { faith: 'jewish', stream: 'secular' });
      expect(await discoverIds(ctx, dan)).toContain(noa.id); // Dan has no filters
      await dealbreakers(dan, { faithOk: ['jewish'], streamOk: ['dati_leumi', 'torani'] });
      expect(await discoverIds(ctx, dan)).not.toContain(noa.id); // wrong stream
      await setFaith(noa, { faith: 'jewish', stream: 'torani' });
      expect(await discoverIds(ctx, dan)).toContain(noa.id);
      // Noa's filter applies to Dan too, who answered nothing: a missing answer passes.
      await dealbreakers(noa, { faithOk: ['jewish'] });
      expect(await discoverIds(ctx, noa)).toContain(dan.id);
      await setFaith(dan, { faith: 'christian', stream: 'catholic' });
      expect(await discoverIds(ctx, noa)).not.toContain(dan.id);
      expect(await discoverIds(ctx, dan)).not.toContain(noa.id); // both ways
      // The module off: filters no longer apply.
      await settings({ faithModule: false });
      expect(await discoverIds(ctx, noa)).toContain(dan.id);
    });

    it('withdrawing the religion consent deletes the answers and the filters', async () => {
      await settings({ faithModule: true });
      await consent(noa, true);
      await setFaith(noa, { faith: 'muslim', stream: 'sunni', observance: { halal: 'yes' } });
      await dealbreakers(noa, { faithOk: ['muslim'] });
      await consent(noa, false);
      const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
      expect(me.faith).toEqual({ faith: null, stream: null, observance: {} });
      expect(me.dealbreakers).toMatchObject({ faithOk: [], streamOk: [] });
    });

    it('partners never get it; marriage travels to them as long-term; in "Download my data"', async () => {
      await settings({ faithModule: true });
      await consent(noa, true);
      await setFaith(noa, { faith: 'druze', observance: { prayer: 'partly' } });
      await api(ctx, noa, 'PATCH', '/v1/me/profile', { intention: 'marriage' });
      const zip = await api(ctx, noa, 'GET', '/v1/me/export');
      const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
      expect(data.about).toMatchObject({ faith: 'druze', observance: { prayer: 'partly' } });
      const { partnerIntention, federatedCardSchema } = await import('@nexaheart/shared');
      expect(partnerIntention('marriage')).toBe('long_term');
      expect(Object.keys(federatedCardSchema.shape)).not.toContain('faith');
    });
  },
);
