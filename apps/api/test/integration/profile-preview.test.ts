// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('see my profile as others do (integration)', () => {
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

  it('is the same card others get, without distance or reasons', async () => {
    await api(ctx, noa, 'PUT', `/v1/me/photos/${noa.photoId}/description`, {
      description: 'On a hike',
    });
    const res = await api(ctx, noa, 'GET', '/v1/me/preview');
    expect(res.statusCode).toBe(200);
    const { profile, hidden, pendingPhotos } = res.json();
    const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json();
    // Everything that doesn't depend on who's looking is identical.
    expect({ ...profile, distance: seen.distance, reasons: seen.reasons }).toEqual(seen);
    expect(profile.distance).toBeNull();
    expect(profile.reasons).toEqual([]);
    expect(profile.photos[0].description).toBe('On a hike');
    expect(hidden).toEqual([]);
    expect(pendingPhotos).toBe(0);
  });

  it('says what keeps the profile out of decks', async () => {
    await q(
      `UPDATE "user" SET incognito = true, paused_at = now(), paused_until = NULL WHERE id = $1`,
      [noa.id],
    );
    await q(`UPDATE photos SET status = 'processing' WHERE user_id = $1`, [noa.id]);
    await q(`DELETE FROM locations WHERE user_id = $1`, [noa.id]);
    const { profile, hidden, pendingPhotos } = (
      await api(ctx, noa, 'GET', '/v1/me/preview')
    ).json();
    expect(hidden).toEqual(['onBreak', 'incognito', 'noPhoto', 'noLocation']);
    expect(pendingPhotos).toBe(1);
    // A photo still being checked isn't shown, here either.
    expect(profile.photos).toEqual([]);
  });

  it('a break that ended no longer hides', async () => {
    await q(
      `UPDATE "user" SET paused_at = now() - interval '2 days', paused_until = now() - interval '1 day' WHERE id = $1`,
      [noa.id],
    );
    expect((await api(ctx, noa, 'GET', '/v1/me/preview')).json().hidden).toEqual([]);
  });

  it('needs a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/preview' });
    expect(res.statusCode).toBe(401);
  });
});
