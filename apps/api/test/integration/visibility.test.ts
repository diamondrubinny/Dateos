// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { SENSITIVE_CONSENT_VERSION } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processPauses } from '../../../worker/src/pause-jobs.js';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('who sees me: take a break (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  const woman = (name = 'Noa') =>
    createMember(ctx, { name, gender: 'woman', interestedIn: ['man'] });
  const man = (name = 'Dan') => createMember(ctx, { name, gender: 'man', interestedIn: ['woman'] });
  const pause = (m: Member, duration: string) => api(ctx, m, 'PUT', '/v1/me/pause', { duration });
  const me = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me')).json();
  const query = (text: string, values: unknown[] = []) =>
    ctx.services.dbHandle.pool.query(text, values);

  it('hides a member on a break from new people, everywhere, and shows the break in /v1/me', async () => {
    const noa = await woman();
    const dan = await man();
    const omer = await man('Omer');
    // Dan liked Noa before her break; Omer never met her.
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    expect(await discoverIds(ctx, omer)).toContain(noa.id);

    expect((await pause(noa, '3d')).statusCode).toBe(200);
    const state = (await me(noa)).pause;
    expect(state.until).not.toBeNull();
    const hours = (Date.parse(state.until) - Date.parse(state.since)) / 3_600_000;
    expect(hours).toBe(72);

    // New people: not in discover, not as a profile, not as photos, can't be liked.
    expect(await discoverIds(ctx, omer)).not.toContain(noa.id);
    expect((await api(ctx, omer, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(404);
    expect((await api(ctx, omer, 'GET', `/v1/photos/${noa.photoId}`)).statusCode).toBe(404);
    expect(
      (await api(ctx, omer, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' }))
        .statusCode,
    ).toBe(404);
    // Her own feeds are calm: nothing to browse, no likes to answer, no liking.
    expect(await discoverIds(ctx, noa)).toEqual([]);
    expect((await api(ctx, noa, 'GET', '/v1/picks/today')).json().profiles).toEqual([]);
    expect((await api(ctx, noa, 'GET', '/v1/likes')).json().likes).toEqual([]);
    expect(
      (await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' }))
        .statusCode,
    ).toBe(403);

    // Coming back: everything returns, including Dan's like waiting for her.
    expect((await api(ctx, noa, 'DELETE', '/v1/me/pause')).statusCode).toBe(200);
    expect((await me(noa)).pause).toBeNull();
    expect(await discoverIds(ctx, omer)).toContain(noa.id);
    const likes = (await api(ctx, noa, 'GET', '/v1/likes')).json().likes;
    expect(likes.map((l: { profile: { id: string } }) => l.profile.id)).toEqual([dan.id]);
  });

  it('hides a liker who takes a break from Likes You, but keeps matches and chats going', async () => {
    const noa = await woman();
    const dan = await man();
    const omer = await man('Omer');
    await api(ctx, omer, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;

    await pause(omer, 'indefinite');
    await pause(dan, 'indefinite');
    expect((await me(dan)).pause.until).toBeNull();
    // Omer's waiting like disappears while he's away...
    expect((await api(ctx, noa, 'GET', '/v1/likes')).json().likes).toEqual([]);
    expect((await api(ctx, noa, 'GET', `/v1/profiles/${omer.id}`)).statusCode).toBe(404);
    // ...but Noa and Dan still see each other and can talk.
    expect((await api(ctx, noa, 'GET', '/v1/matches')).json().matches).toHaveLength(1);
    expect((await api(ctx, noa, 'GET', `/v1/profiles/${dan.id}`)).statusCode).toBe(200);
    const sent = await api(ctx, dan, 'POST', `/v1/matches/${matchId}/messages`, {
      text: 'Still here, just taking a break from new people',
      clientId: 'break-message-1',
    });
    expect(sent.statusCode).toBe(200);
  });

  it('ends a break by itself, tells the member once, and never overrides a missing consent', async () => {
    const noa = await woman();
    const omer = await man('Omer');
    await pause(noa, '24h');
    // The time is up: visible at once, before the worker runs.
    await query(`UPDATE "user" SET paused_until = now() - interval '1 minute' WHERE id = $1`, [
      noa.id,
    ]);
    expect((await me(noa)).pause).toBeNull();
    expect(await discoverIds(ctx, omer)).toContain(noa.id);

    const told: string[] = [];
    const sweep = () =>
      processPauses({
        db: ctx.services.dbHandle.db,
        tellVisible: async (id) => void told.push(id),
      });
    expect(await sweep()).toEqual({ ended: 1 });
    expect(await sweep()).toEqual({ ended: 0 });
    expect(told).toEqual([noa.id]);
    const { rows } = await query('SELECT paused_at, paused_until FROM "user" WHERE id = $1', [
      noa.id,
    ]);
    expect(rows[0]).toEqual({ paused_at: null, paused_until: null });

    // An indefinite break is never ended by the worker.
    await pause(omer, 'indefinite');
    expect(await sweep()).toEqual({ ended: 0 });

    // Ending a break doesn't bring back someone hidden for a withdrawn consent.
    await api(ctx, noa, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'sensitive', granted: false, version: SENSITIVE_CONSENT_VERSION }],
    });
    await pause(noa, '24h');
    await api(ctx, noa, 'DELETE', '/v1/me/pause');
    expect((await me(noa)).user.status).toBe('paused');
    await api(ctx, omer, 'DELETE', '/v1/me/pause');
    expect(await discoverIds(ctx, omer)).not.toContain(noa.id);
  });

  it('incognito: only people I liked see me, matches stay, and nobody is told', async () => {
    const noa = await woman();
    const dan = await man();
    const omer = await man('Omer');
    const gil = await man('Gil');
    // Gil and Noa matched before she went incognito.
    await api(ctx, gil, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: gil.id, kind: 'like' });

    expect((await api(ctx, noa, 'PUT', '/v1/me/incognito', { on: true })).statusCode).toBe(200);
    expect((await me(noa)).incognito).toBe(true);
    for (const viewer of [dan, omer]) {
      expect(await discoverIds(ctx, viewer)).not.toContain(noa.id);
      expect((await api(ctx, viewer, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(404);
      expect((await api(ctx, viewer, 'GET', `/v1/photos/${noa.photoId}`)).statusCode).toBe(404);
      expect(
        (await api(ctx, viewer, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' }))
          .statusCode,
      ).toBe(404);
    }
    // She still browses as usual.
    expect(await discoverIds(ctx, noa)).toEqual(expect.arrayContaining([dan.id, omer.id]));
    // Her match is untouched.
    expect((await api(ctx, gil, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(200);
    expect((await api(ctx, gil, 'GET', '/v1/matches')).json().matches).toHaveLength(1);

    // She likes Dan: now Dan (only Dan) can see her, in Likes You and on her profile.
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    const likes = (await api(ctx, dan, 'GET', '/v1/likes')).json().likes;
    expect(likes.map((l: { profile: { id: string } }) => l.profile.id)).toEqual([noa.id]);
    const profile = await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`);
    expect(profile.statusCode).toBe(200);
    expect(JSON.stringify(profile.json())).not.toMatch(/incognito/i);
    expect(await discoverIds(ctx, omer)).not.toContain(noa.id);
    // Dan can answer, and they match.
    expect(
      (await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' })).json()
        .matched,
    ).toBe(true);

    // Turning it off: visible to everyone again.
    await api(ctx, noa, 'PUT', '/v1/me/incognito', { on: false });
    expect(await discoverIds(ctx, omer)).toContain(noa.id);
    expect((await api(ctx, noa, 'PUT', '/v1/me/incognito', { on: 'yes' })).statusCode).toBe(400);
  });

  it('validates the duration and keeps the break in "Download my data"', async () => {
    const noa = await woman();
    expect((await pause(noa, '1y')).statusCode).toBe(400);
    expect((await api(ctx, noa, 'PUT', '/v1/me/pause', {})).statusCode).toBe(400);
    await pause(noa, '7d');
    const { rows } = await query(
      'SELECT paused_until - paused_at AS span FROM "user" WHERE id = $1',
      [noa.id],
    );
    expect(rows[0].span).toMatchObject({ days: 7 });
  });
});
