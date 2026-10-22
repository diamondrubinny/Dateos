// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { mediaKey } from '@nexaheart/storage';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const BOUNDARY = 'nexaheartboundary';

function multipart(file: Buffer, filename = 'photo.png', contentType = 'image/png') {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, file, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

const png = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: '#7c3aed' } })
    .png()
    .toBuffer();

describe.skipIf(!integrationEnabled)('photos (integration)', () => {
  let ctx: TestContext;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    alice = await signIn(ctx, 'alice@example.test');
    bob = await signIn(ctx, 'bob@example.test');
  });

  async function upload(cookie: string, file?: Buffer, filename?: string, type?: string) {
    const body = multipart(file ?? (await png()), filename, type);
    return ctx.app.inject({
      method: 'POST',
      url: '/v1/me/photos',
      headers: { cookie, ...body.headers },
      payload: body.payload,
    });
  }

  /** Simulates the worker finishing: stores a processed file and marks the photo clean. */
  async function markClean(photoId: string) {
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT user_id FROM photos WHERE id = $1',
      [photoId],
    );
    const key = mediaKey(rows[0].user_id, photoId);
    const webp = await sharp(await png())
      .webp()
      .toBuffer();
    await ctx.services.storage.put(ctx.services.storage.buckets.media, key, webp, 'image/webp');
    await ctx.services.dbHandle.pool.query(
      `UPDATE photos SET status = 'clean', media_key = $2, width = 64, height = 64 WHERE id = $1`,
      [photoId, key],
    );
  }

  it('stores uploads in quarantine and queues them for scanning', async () => {
    const res = await upload(alice);
    expect(res.statusCode).toBe(202);
    const photo = res.json();
    expect(photo).toMatchObject({ status: 'quarantine', position: 0, url: null });
    expect(ctx.jobs.process).toEqual([{ photoId: photo.id }]);

    const { rows } = await ctx.services.dbHandle.pool.query('SELECT quarantine_key FROM photos');
    const stored = await ctx.services.storage.getBuffer(
      ctx.services.storage.buckets.quarantine,
      rows[0].quarantine_key,
    );
    expect(stored.equals(await png())).toBe(true);
  });

  it('checks the real file type, not the declared one', async () => {
    const fake = Buffer.from('<?php system($_GET["c"]); ?>');
    const res = await upload(alice, fake, 'innocent.jpg', 'image/jpeg');
    expect(res.statusCode).toBe(415);
    expect(ctx.jobs.process).toHaveLength(0);
  });

  it('rejects files over 10 MB', async () => {
    const huge = Buffer.concat([await png(), Buffer.alloc(10 * 1024 * 1024 + 1)]);
    const res = await upload(alice, huge);
    expect(res.statusCode).toBe(413);
  });

  it('enforces the 9 photo limit even under parallel uploads', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => upload(alice)));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 202)).toHaveLength(9);
    expect(codes.filter((c) => c === 409)).toHaveLength(3);
    const positions = results.filter((r) => r.statusCode === 202).map((r) => r.json().position);
    expect(new Set(positions).size).toBe(9);
  });

  it('serves clean photos only to their owner (no IDOR)', async () => {
    const { id } = (await upload(alice)).json();
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/v1/photos/${id}`, headers: { cookie: alice } }))
        .statusCode,
    ).toBe(404); // not clean yet

    await markClean(id);
    const own = await ctx.app.inject({
      method: 'GET',
      url: `/v1/photos/${id}`,
      headers: { cookie: alice },
    });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('image/webp');
    expect(own.headers['cache-control']).toBe('private, max-age=300');

    const other = await ctx.app.inject({
      method: 'GET',
      url: `/v1/photos/${id}`,
      headers: { cookie: bob },
    });
    expect(other.statusCode).toBe(404);
    const anon = await ctx.app.inject({ method: 'GET', url: `/v1/photos/${id}` });
    expect(anon.statusCode).toBe(401);
  });

  it("does not let other users delete or reorder someone else's photos", async () => {
    const { id } = (await upload(alice)).json();
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/me/photos/${id}`,
      headers: { cookie: bob },
    });
    expect(del.statusCode).toBe(404);
    const reorder = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/photos/order',
      headers: { cookie: bob },
      payload: { photoIds: [id] },
    });
    expect(reorder.statusCode).toBe(400);
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT count(*)::int AS n FROM photos',
    );
    expect(rows[0].n).toBe(1);
  });

  it('reorders and deletes own photos', async () => {
    const a = (await upload(alice)).json().id;
    const b = (await upload(alice)).json().id;
    const reorder = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/photos/order',
      headers: { cookie: alice },
      payload: { photoIds: [b, a] },
    });
    expect(reorder.statusCode).toBe(200);
    const me = (
      await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: alice } })
    ).json();
    expect(me.photos.map((p: { id: string }) => p.id)).toEqual([b, a]);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/me/photos/${a}`,
      headers: { cookie: alice },
    });
    expect(del.statusCode).toBe(200);
    expect(ctx.jobs.delete).toHaveLength(1);
    expect(ctx.jobs.delete[0]!.quarantineKeys[0]).toContain(a);
  });

  it('queues storage cleanup when the account is deleted', async () => {
    const { id } = (await upload(alice)).json();
    await markClean(id);
    await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: { cookie: alice } });
    expect(ctx.jobs.delete).toHaveLength(1);
    expect(ctx.jobs.delete[0]!.mediaKeys).toEqual([expect.stringContaining(id)]);
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT count(*)::int AS n FROM photos',
    );
    expect(rows[0].n).toBe(0);
  });
});
