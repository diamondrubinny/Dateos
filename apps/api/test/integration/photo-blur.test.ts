// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BLURRED_WIDTH } from '../../src/lib/photo-blur.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('blurred profile photos, phase 66a (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let eli: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
    await q(`UPDATE photos SET description = 'Me on a bike in Jaffa' WHERE id = $1`, [noa.photoId]);
  });

  /** How a viewer gets Noa's photo: width (16 when blurred) and caching. */
  async function photoAs(viewer: Member, owner = noa) {
    const res = await api(ctx, viewer, 'GET', `/v1/photos/${owner.photoId}`);
    expect(res.statusCode).toBe(200);
    const { width } = await sharp(res.rawPayload).metadata();
    return { width, cache: res.headers['cache-control'] };
  }
  const card = async (viewer: Member, owner = noa) =>
    (await api(ctx, viewer, 'GET', `/v1/profiles/${owner.id}`)).json().photos[0];
  async function match(a: Member, b: Member): Promise<string> {
    await api(ctx, a, 'POST', '/v1/interactions', { targetId: b.id, kind: 'like' });
    return (await api(ctx, b, 'POST', '/v1/interactions', { targetId: a.id, kind: 'like' })).json()
      .matchId;
  }
  const show = (m: Member, matchId: string, shown: boolean) =>
    api(ctx, m, 'PUT', `/v1/matches/${matchId}/photos-shown`, { shown });

  it('off by default: everyone allowed sees the real photo, cached as before', async () => {
    expect((await api(ctx, noa, 'GET', '/v1/me/settings')).json().blurPhotos).toBe(false);
    expect(await photoAs(dan)).toEqual({ width: 64, cache: 'private, max-age=300' });
    expect(await card(dan)).toMatchObject({ description: 'Me on a bike in Jaffa' });
    expect((await card(dan)).blurred).toBeUndefined();
  });

  it('blurred on the server for others, never cached, no description; the owner sees it clear', async () => {
    await api(ctx, noa, 'PUT', '/v1/me/settings', { blurPhotos: true });
    expect(await photoAs(dan)).toEqual({ width: BLURRED_WIDTH, cache: 'private, no-store' });
    expect(await card(dan)).toMatchObject({ blurred: true, description: null });
    expect((await photoAs(noa)).width).toBe(64);
    // Her preview shows what strangers see.
    expect((await api(ctx, noa, 'GET', '/v1/me/preview')).json().profile.photos[0]).toMatchObject({
      blurred: true,
    });
  });

  it('shown to one match by choice, taken back, and gone with the match', async () => {
    await api(ctx, noa, 'PUT', '/v1/me/settings', { blurPhotos: true });
    const matchId = await match(dan, noa);
    // Matching alone doesn't show them.
    expect((await photoAs(dan)).width).toBe(BLURRED_WIDTH);
    const page = () => api(ctx, noa, 'GET', `/v1/matches/${matchId}/messages`);
    expect((await page()).json().myPhotosShown).toBe(false);
    expect((await show(noa, matchId, true)).statusCode).toBe(200);
    expect((await page()).json().myPhotosShown).toBe(true);
    expect(await photoAs(dan)).toEqual({ width: 64, cache: 'private, no-store' });
    expect(await card(dan)).toMatchObject({ description: 'Me on a bike in Jaffa' });
    // Only to Dan.
    expect((await photoAs(eli)).width).toBe(BLURRED_WIDTH);
    // Someone else can't show them in a match that isn't theirs.
    expect((await show(eli, matchId, true)).statusCode).toBe(404);
    // Taken back.
    await show(noa, matchId, false);
    expect((await photoAs(dan)).width).toBe(BLURRED_WIDTH);
    // Shown again, then the match ends: hidden again.
    await show(noa, matchId, true);
    expect((await api(ctx, dan, 'DELETE', `/v1/matches/${matchId}`)).statusCode).toBe(200);
    const after = await api(ctx, dan, 'GET', `/v1/photos/${noa.photoId}`);
    if (after.statusCode === 200) {
      expect((await sharp(after.rawPayload).metadata()).width).toBe(BLURRED_WIDTH);
    } else {
      expect(after.statusCode).toBe(404);
    }
    const { rows } = await q('SELECT count(*)::int AS n FROM photo_reveals');
    expect(rows[0].n).toBeLessThanOrEqual(1); // kept with the ended match until it's deleted
  });

  it('a community with photos after a match: blurred for strangers, clear for matches', async () => {
    await q('UPDATE instance_settings SET photos_after_match = true WHERE id = 1');
    await q(
      'INSERT INTO instance_settings (id, photos_after_match) VALUES (1, true) ON CONFLICT (id) DO NOTHING',
    );
    ctx.services.instance.invalidate();
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json().community,
    ).toMatchObject({ photosAfterMatch: true });
    expect(await photoAs(dan)).toEqual({ width: BLURRED_WIDTH, cache: 'private, no-store' });
    await match(dan, noa);
    expect((await photoAs(dan)).width).toBe(64);
    expect((await photoAs(noa, dan)).width).toBe(64);
    expect((await photoAs(eli)).width).toBe(BLURRED_WIDTH);
  });

  it('in "Download my data"', async () => {
    await api(ctx, noa, 'PUT', '/v1/me/settings', { blurPhotos: true });
    const matchId = await match(dan, noa);
    await show(noa, matchId, true);
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.preferences).toMatchObject({ blurPhotos: true });
    expect(data.matches[0]).toMatchObject({ id: matchId, youShowedYourPhotos: true });
  });
});
