// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { mediaKey } from '@nexaheart/storage';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('private albums, phase 66c (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let eli: Member;
  let matchId: string;
  let albumPhoto: string;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));

  /** A clean album photo, as the worker would leave it. */
  async function addAlbumPhoto(owner: Member): Promise<string> {
    const { rows } = await q(
      `INSERT INTO photos (user_id, status, purpose, position, width, height)
       VALUES ($1, 'clean', 'album', 0, 32, 32) RETURNING id`,
      [owner.id],
    );
    const id = rows[0].id as string;
    const key = mediaKey(owner.id, id);
    await q('UPDATE photos SET media_key = $2 WHERE id = $1', [id, key]);
    const webp = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#0ea5e9' },
    })
      .webp()
      .toBuffer();
    await ctx.services.storage.put(ctx.services.storage.buckets.media, key, webp, 'image/webp');
    return id;
  }

  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;
    albumPhoto = await addAlbumPhoto(noa);
  });

  const photo = (m: Member) => api(ctx, m, 'GET', `/v1/photos/${albumPhoto}`);
  const share = (mode: string) =>
    api(ctx, noa, 'PUT', `/v1/matches/${matchId}/album-share`, { mode });
  const open = () => api(ctx, dan, 'GET', `/v1/matches/${matchId}/album`);
  const page = (m: Member) => api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`);

  it('private: never on the profile; only the owner gets the photos, never cached', async () => {
    const mine = (await api(ctx, noa, 'GET', '/v1/me/album')).json();
    expect(mine.photos).toEqual([
      expect.objectContaining({ id: albumPhoto, status: 'clean', url: `/v1/photos/${albumPhoto}` }),
    ]);
    const profile = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json();
    expect(profile.photos.map((p: { id: string }) => p.id)).not.toContain(albumPhoto);
    const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
    expect(me.photos.map((p: { id: string }) => p.id)).not.toContain(albumPhoto);
    const own = await photo(noa);
    expect(own.statusCode).toBe(200);
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect((await photo(dan)).statusCode).toBe(404); // a match, before it's shared
    expect((await photo(eli)).statusCode).toBe(404);
  });

  it('up to 6 photos', async () => {
    for (let i = 0; i < 5; i += 1) await addAlbumPhoto(noa);
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .webp()
      .toBuffer();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(webp)], { type: 'image/webp' }), 'a.webp');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/album/photos',
      headers: { cookie: noa.cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(409);
  });

  it('once: open for a minute from the first look, then "already viewed"', async () => {
    expect((await share('once')).statusCode).toBe(200);
    expect((await page(dan)).json().theirAlbum).toEqual({
      mode: 'once',
      openedAt: null,
      open: true,
    });
    expect((await photo(dan)).statusCode).toBe(404); // not opened yet
    const first = (await open()).json();
    expect(first.photos).toEqual([{ id: albumPhoto, url: `/v1/photos/${albumPhoto}` }]);
    const left = (Date.parse(first.expiresAt) - Date.now()) / 1000;
    expect(left).toBeGreaterThan(50);
    expect(left).toBeLessThanOrEqual(61);
    const seen = await photo(dan);
    expect(seen.statusCode).toBe(200);
    expect(seen.headers['cache-control']).toBe('private, no-store');
    expect((await photo(eli)).statusCode).toBe(404); // only Dan
    // The minute passes.
    await q(`UPDATE album_shares SET expires_at = now() - interval '1 second'`);
    expect((await photo(dan)).statusCode).toBe(404);
    const after = (await open()).json();
    expect(after).toMatchObject({ photos: [], share: { mode: 'once', open: false } });
    expect((await page(noa)).json().myAlbum).toMatchObject({
      share: { mode: 'once', open: false },
    });
    // Sharing again starts over.
    await share('once');
    expect((await open()).json().photos).toHaveLength(1);
  });

  it('10 minutes from the first look; no limit stays open', async () => {
    await share('ten_minutes');
    const first = (await open()).json();
    const left = (Date.parse(first.expiresAt) - Date.now()) / 1000;
    expect(left).toBeGreaterThan(590);
    expect(left).toBeLessThanOrEqual(601);
    await share('unlimited');
    expect((await open()).json()).toMatchObject({ expiresAt: null, photos: [{ id: albumPhoto }] });
    await q(`UPDATE album_shares SET opened_at = now() - interval '30 days'`);
    expect((await photo(dan)).statusCode).toBe(200);
  });

  it('stop sharing, or the match ends: closed at once', async () => {
    await share('unlimited');
    await open();
    expect((await photo(dan)).statusCode).toBe(200);
    expect((await api(ctx, noa, 'DELETE', `/v1/matches/${matchId}/album-share`)).statusCode).toBe(
      200,
    );
    expect((await photo(dan)).statusCode).toBe(404);
    expect((await page(dan)).json().theirAlbum).toBeNull();
    await share('unlimited');
    await open();
    await api(ctx, dan, 'DELETE', `/v1/matches/${matchId}`);
    expect((await photo(dan)).statusCode).toBe(404);
  });

  it('only in my own matches, and only with a photo ready', async () => {
    expect(
      (await api(ctx, eli, 'PUT', `/v1/matches/${matchId}/album-share`, { mode: 'once' }))
        .statusCode,
    ).toBe(404);
    await q(`DELETE FROM photos WHERE purpose = 'album'`);
    expect((await share('once')).statusCode).toBe(409);
    expect((await page(noa)).json().myAlbum).toBeNull();
    expect((await share('forever')).statusCode).toBe(400);
  });

  it('in "Download my data"', async () => {
    await share('once');
    await open();
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.privateAlbum.photos).toEqual([expect.objectContaining({ id: albumPhoto })]);
    expect(data.privateAlbum.sharedWith).toEqual([
      expect.objectContaining({ matchId, mode: 'once', firstViewedAt: expect.any(String) }),
    ]);
  });
});
