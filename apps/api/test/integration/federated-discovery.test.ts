// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  FEDERATION_CONSENT_VERSION,
  FederationHeader,
  type FederatedMatch,
  type FederatedProfile,
} from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member, type MemberOptions } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const A_URL = 'https://a.example.test';
const B_URL = 'https://b.example.test';

/** The network between the two test servers: a request to the other address reaches its app. */
function bridge(origin: string, target: () => TestContext): typeof fetch {
  return (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== origin) throw new Error(`unexpected host ${url.origin}`);
    const res = await target().app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers)),
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    }
    return new Response(res.rawPayload, { status: res.statusCode, headers });
  }) as typeof fetch;
}

describe.skipIf(!integrationEnabled)(
  'partner communities: discovery and matching (integration)',
  () => {
    let a: TestContext;
    let b: TestContext;
    const qa = (sql: string, params: unknown[] = []) => a.services.dbHandle.pool.query(sql, params);
    const qb = (sql: string, params: unknown[] = []) => b.services.dbHandle.pool.query(sql, params);

    beforeAll(async () => {
      a = await setupIntegration({
        federation: true,
        apiUrl: A_URL,
        fetch: bridge(B_URL, () => b),
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

    async function connect() {
      const adminA = await signIn(a, 'admin-a@example.test');
      const adminB = await signIn(b, 'admin-b@example.test');
      const idOf = async (ctx: TestContext, cookie: string) =>
        (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json().user
          .id as string;
      await a.services.federation.invite(await idOf(a, adminA), B_URL);
      const atB = await b.services.federation.list();
      await b.services.federation.accept(await idOf(b, adminB), atB.partners[0]!.id);
      expect((await a.services.federation.list()).partners[0]?.status).toBe('active');
    }

    async function join(ctx: TestContext, m: Member) {
      const res = await api(ctx, m, 'POST', '/v1/federated/join', {
        version: FEDERATION_CONSENT_VERSION,
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    async function member(ctx: TestContext, o: MemberOptions, joined = true) {
      const m = await createMember(ctx, o);
      if (joined) await join(ctx, m);
      return m;
    }

    async function deck(ctx: TestContext, m: Member): Promise<FederatedProfile[]> {
      const res = await api(ctx, m, 'GET', '/v1/federated/deck');
      expect(res.statusCode, res.body).toBe(200);
      return res.json();
    }

    const matchesOf = async (ctx: TestContext, m: Member): Promise<FederatedMatch[]> =>
      (await api(ctx, m, 'GET', '/v1/federated/matches')).json();

    const decide = (
      ctx: TestContext,
      m: Member,
      p: FederatedProfile,
      kind: 'like' | 'pass' | 'block',
    ) =>
      api(ctx, m, 'POST', '/v1/federated/interactions', {
        partnerId: p.partnerId,
        alias: p.alias,
        kind,
      });

    beforeEach(async () => {
      await resetState(a);
      await resetState(b);
      await connect();
    });

    it('shows only members who joined, both ways through the filters, with nothing extra', async () => {
      const noa = await member(a, {
        name: 'Noa',
        gender: 'woman',
        interestedIn: ['man'],
        birthDate: '1995-01-01',
      });
      // Before joining nothing crosses, and an un-joined member can't browse.
      const dan = await member(b, { name: 'Dan', gender: 'man', interestedIn: ['woman'] }, false);
      await member(b, { name: 'Eli', gender: 'man', interestedIn: ['man'] }); // wants men only
      await member(b, {
        name: 'Omer',
        gender: 'man',
        interestedIn: ['woman'],
        prefs: { ageMin: 18, ageMax: 25, maxDistanceKm: 50 }, // Noa is 31
      });
      await member(b, { name: 'Maya', gender: 'woman', interestedIn: ['man'] }); // not who Noa wants
      expect(await deck(a, noa)).toEqual([]);
      expect((await api(b, dan, 'GET', '/v1/federated/deck')).statusCode).toBe(403);

      const status = (await api(b, dan, 'GET', '/v1/federated/status')).json();
      expect(status).toMatchObject({ available: true, joined: false, consentVersion: '1' });
      expect(status.partners).toHaveLength(1);
      await join(b, dan);

      const cards = await deck(a, noa);
      expect(cards.map((c) => c.displayName)).toEqual(['Dan']);
      const card = cards[0]!;
      // A pseudonym, never the real id; and nothing but the card.
      expect(card.alias).not.toBe(dan.id);
      expect(card.alias).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Object.keys(card).sort()).toEqual(
        [
          'age',
          'alias',
          'bio',
          'community',
          'displayName',
          'gender',
          'intention',
          'languages',
          'partnerId',
          'photos',
          'prompts',
          'verified',
        ].sort(),
      );
      expect(JSON.stringify(card)).not.toContain('@example.test');
      expect(card.prompts[0]?.answer).toBe('Dan likes kindness');
      expect(card.photos[0]?.url).toBe(`/v1/federated/photos/${card.partnerId}/${dan.photoId}`);

      // The photo comes through Noa's own server.
      const photo = await api(a, noa, 'GET', card.photos[0]!.url);
      expect(photo.statusCode).toBe(200);
      expect(photo.headers['content-type']).toBe('image/webp');
      expect(photo.rawPayload.subarray(8, 12).toString()).toBe('WEBP');
      // A photo that isn't someone's who takes part isn't served.
      const other = (await qb(`SELECT id FROM photos WHERE user_id <> $1 LIMIT 1`, [dan.id]))
        .rows[0];
      await qb(
        `INSERT INTO consents (user_id, kind, granted, version) SELECT user_id, 'federation', false, '1' FROM photos WHERE id = $1`,
        [other.id],
      );
      expect(
        (await api(a, noa, 'GET', `/v1/federated/photos/${card.partnerId}/${other.id}`)).statusCode,
      ).toBe(404);

      // Incognito hides a member from partners too.
      await qb(`UPDATE "user" SET incognito = true WHERE id = $1`, [dan.id]);
      expect(await deck(a, noa)).toEqual([]);
    });

    it('a mutual like is a match on both servers; a pass and a block leave people out', async () => {
      const noa = await member(a, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      const dan = await member(b, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      const tom = await member(b, { name: 'Tom', gender: 'man', interestedIn: ['woman'] });

      const cards = await deck(a, noa);
      expect(cards.map((c) => c.displayName).sort()).toEqual(['Dan', 'Tom']);
      const danCard = cards.find((c) => c.displayName === 'Dan')!;
      const tomCard = cards.find((c) => c.displayName === 'Tom')!;

      // Noa likes Dan first: no match yet.
      const first = await decide(a, noa, danCard, 'like');
      expect(first.json()).toEqual({ matched: false });
      expect((await decide(a, noa, danCard, 'like')).statusCode).toBe(409);
      expect(await matchesOf(a, noa)).toEqual([]);
      // Noa passes on Tom: he's left out from now on.
      await decide(a, noa, tomCard, 'pass');
      expect(await deck(a, noa)).toEqual([]);

      // Dan sees Noa and likes her back: a match on both sides.
      const noaCard = (await deck(b, dan)).find((c) => c.displayName === 'Noa')!;
      expect(noaCard.community).toBe('NexaHeart');
      const second = await decide(b, dan, noaCard, 'like');
      expect(second.json()).toEqual({ matched: true });
      const atB = await matchesOf(b, dan);
      const atA = await matchesOf(a, noa);
      expect(atB.map((m) => m.displayName)).toEqual(['Noa']);
      expect(atA.map((m) => m.displayName)).toEqual(['Dan']);
      expect(atA[0]!.photo?.url).toBe(`/v1/federated/photos/${atA[0]!.partnerId}/${dan.photoId}`);
      expect((await api(a, noa, 'GET', atA[0]!.photo!.url)).statusCode).toBe(200);
      // Each server keeps only its own member's side, under the other person's alias.
      expect((await qa('SELECT user_id FROM federation_matches')).rows).toEqual([
        { user_id: noa.id },
      ]);
      expect((await qb('SELECT user_id FROM federation_matches')).rows).toEqual([
        { user_id: dan.id },
      ]);

      // Dan blocks Noa: the match ends on both sides, and neither sees the other again.
      await decide(b, dan, noaCard, 'block');
      expect(await matchesOf(b, dan)).toEqual([]);
      expect(await matchesOf(a, noa)).toEqual([]);
      expect((await deck(b, dan)).map((c) => c.displayName)).toEqual([]);
      await qa('DELETE FROM federation_decisions WHERE user_id = $1', [noa.id]);
      expect((await deck(a, noa)).map((c) => c.displayName)).toEqual(['Tom']);
      void tom;
    });

    it('unmatching tells the partner', async () => {
      const noa = await member(a, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      const dan = await member(b, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      await decide(a, noa, (await deck(a, noa))[0]!, 'like');
      await decide(b, dan, (await deck(b, dan))[0]!, 'like');
      const [match] = await matchesOf(a, noa);
      expect((await api(a, noa, 'DELETE', `/v1/federated/matches/${match!.id}`)).statusCode).toBe(
        200,
      );
      expect(await matchesOf(a, noa)).toEqual([]);
      expect(await matchesOf(b, dan)).toEqual([]);
      expect((await api(b, dan, 'DELETE', `/v1/federated/matches/${match!.id}`)).statusCode).toBe(
        404,
      );
    });

    it('leaving, deleting an account and ending the partnership delete what crossed', async () => {
      const noa = await member(a, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      const dan = await member(b, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
      const tom = await member(b, { name: 'Tom', gender: 'man', interestedIn: ['woman'] });
      for (const card of await deck(a, noa)) await decide(a, noa, card, 'like');
      await decide(b, dan, (await deck(b, dan))[0]!, 'like');
      expect(await matchesOf(b, dan)).toHaveLength(1);

      // Noa leaves: B forgets her alias, A forgets everything about her and partners.
      const left = (await api(a, noa, 'POST', '/v1/federated/leave')).json();
      expect(left.joined).toBe(false);
      expect(await matchesOf(b, dan)).toEqual([]);
      expect((await deck(b, dan)).map((c) => c.displayName)).toEqual([]);
      for (const table of ['federation_aliases', 'federation_decisions', 'federation_matches']) {
        expect((await qa(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
      }
      expect((await api(a, noa, 'GET', '/v1/federated/deck')).statusCode).toBe(403);

      // She joins again (with a new alias); then Dan deletes his account, and A is told.
      await join(a, noa);
      await decide(
        a,
        noa,
        (await deck(a, noa)).find((c) => c.displayName === 'Dan')!,
        'like',
      );
      await decide(b, dan, (await deck(b, dan))[0]!, 'like');
      expect(await matchesOf(a, noa)).toHaveLength(1);
      expect((await api(b, dan, 'DELETE', '/v1/me')).statusCode).toBe(200);
      expect(await matchesOf(a, noa)).toEqual([]);
      expect((await qa('SELECT count(*)::int AS n FROM federation_decisions')).rows[0].n).toBe(0);

      // Ending the partnership deletes the rest on both sides.
      await decide(
        a,
        noa,
        (await deck(a, noa)).find((c) => c.displayName === 'Tom')!,
        'like',
      );
      const partnerAtA = (await a.services.federation.list()).partners[0]!;
      const adminA = (await qa(`SELECT id FROM "user" WHERE email = 'admin-a@example.test'`))
        .rows[0];
      await a.services.federation.end(adminA.id, partnerAtA.id);
      for (const q of [qa, qb]) {
        for (const table of ['federation_aliases', 'federation_decisions', 'federation_matches']) {
          expect((await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
        }
      }
      expect((await api(a, noa, 'GET', '/v1/federated/status')).json().available).toBe(false);
      expect(await deck(a, noa)).toEqual([]);
      void tom;
    });

    it('refuses unsigned requests and the generic consent route', async () => {
      const noa = await member(a, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
      const unsigned = await b.app.inject({
        method: 'POST',
        url: '/v1/federation/discover',
        payload: { viewer: {}, exclude: [] },
      });
      expect(unsigned.statusCode).toBe(401);
      // Signed by A but malformed.
      const partnerAtA = (await a.services.federation.list()).partners[0]!;
      await expect(
        a.services.federation.send(partnerAtA.url, 'POST', '/v1/federation/likes', { from: 'x' }),
      ).rejects.toThrow(/400/);
      const viaConsents = await api(a, noa, 'PUT', '/v1/me/consents', {
        consents: [{ kind: 'federation', granted: false, version: '1' }],
      });
      expect(viaConsents.statusCode).toBe(400);
      // A wrong consent version is refused.
      const old = await api(a, noa, 'POST', '/v1/federated/join', { version: '0' });
      expect(old.statusCode).toBe(409);
      expect(FederationHeader.Signature).toBe('x-nexaheart-signature');
    });
  },
);
