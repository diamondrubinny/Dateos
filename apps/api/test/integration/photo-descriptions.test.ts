// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('photo descriptions (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });
  const describePhoto = (m: Member, photoId: string, description: string) =>
    api(ctx, m, 'PUT', `/v1/me/photos/${photoId}/description`, { description });

  it('my description is on my photos and on my card in other people’s decks', async () => {
    const text = 'Me hiking in the Galilee at sunrise';
    expect((await describePhoto(noa, noa.photoId, `  ${text}  `)).statusCode).toBe(200);
    const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
    expect(me.photos[0].description).toBe(text);

    const deck = (await api(ctx, dan, 'GET', '/v1/discover')).json().profiles as {
      id: string;
      photos: { description?: string | null }[];
    }[];
    expect(deck.find((p) => p.id === noa.id)?.photos[0]?.description).toBe(text);

    // It's in "Download my data".
    const exported = await api(ctx, noa, 'GET', '/v1/me/export');
    expect(exported.statusCode).toBe(200);
    const data = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(exported.rawPayload))['data.json']!),
    );
    expect(data.photos[0].description).toBe(text);

    // Empty clears it.
    await describePhoto(noa, noa.photoId, '   ');
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().photos[0].description).toBeNull();
  });

  it('only my own photos; harmful or too-long text is refused', async () => {
    expect((await describePhoto(dan, noa.photoId, 'Not mine')).statusCode).toBe(404);
    expect(
      (await describePhoto(noa, '00000000-0000-4000-8000-000000000000', 'Nothing')).statusCode,
    ).toBe(404);
    expect((await describePhoto(noa, noa.photoId, 'you are an idiot')).statusCode).toBe(400);
    expect((await describePhoto(noa, noa.photoId, 'x'.repeat(151))).statusCode).toBe(400);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().photos[0].description ?? null).toBeNull();
  });
});
