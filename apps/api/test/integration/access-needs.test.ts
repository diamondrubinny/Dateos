// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { ACCESSIBILITY_CONSENT_VERSION } from '@nexaheart/shared';
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

describe.skipIf(!integrationEnabled)('accessibility needs (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  const woman = () => createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
  const man = () => createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  const consent = (m: Member, granted: boolean) =>
    api(ctx, m, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'accessibility', granted, version: ACCESSIBILITY_CONSENT_VERSION }],
    });
  const setNeeds = (m: Member, needs: string[], show: boolean) =>
    api(ctx, m, 'PUT', '/v1/me/access-needs', { needs, show });
  const mine = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me')).json().accessNeeds;
  const seenBy = async (viewer: Member, owner: Member) =>
    (await api(ctx, viewer, 'GET', `/v1/profiles/${owner.id}`)).json().accessNeeds;

  it('needs its own consent, and stores nothing without it', async () => {
    const noa = await woman();
    const res = await setNeeds(noa, ['wheelchair'], true);
    expect(res.statusCode).toBe(403);
    expect(await mine(noa)).toEqual({ needs: [], show: false });
    // Clearing them never needs consent.
    expect((await setNeeds(noa, [], false)).statusCode).toBe(200);
    // An old version of the consent text is not enough.
    await api(ctx, noa, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'accessibility', granted: true, version: '0' }],
    });
    expect((await setNeeds(noa, ['wheelchair'], false)).statusCode).not.toBe(200);
  });

  it('validates the list', async () => {
    const noa = await woman();
    await consent(noa, true);
    expect((await setNeeds(noa, ['flying'], false)).statusCode).toBe(400);
    expect((await setNeeds(noa, ['deaf_hoh', 'deaf_hoh'], false)).statusCode).toBe(400);
    expect(
      (await api(ctx, noa, 'PUT', '/v1/me/access-needs', { needs: [], show: false, x: 1 }))
        .statusCode,
    ).toBe(400);
  });

  it('shows the needs to others only when the member chose to', async () => {
    const noa = await woman();
    const dan = await man();
    await consent(noa, true);
    expect((await setNeeds(noa, ['wheelchair', 'text_first'], false)).statusCode).toBe(200);
    expect(await mine(noa)).toEqual({ needs: ['wheelchair', 'text_first'], show: false });
    // Private: only Noa's own app uses them.
    expect(await seenBy(dan, noa)).toEqual([]);
    const deck = (await api(ctx, dan, 'GET', '/v1/discover?limit=20')).json().profiles;
    expect(deck.find((p: { id: string }) => p.id === noa.id)?.accessNeeds).toEqual([]);

    await setNeeds(noa, ['wheelchair', 'text_first'], true);
    expect(await seenBy(dan, noa)).toEqual(['wheelchair', 'text_first']);
    // Editing about-me leaves them as they are.
    await api(ctx, noa, 'PUT', '/v1/me/about', {
      interests: ['hiking'],
      children: null,
      smoking: null,
      drinking: null,
      heightCm: null,
      religion: null,
      openingQuestion: null,
    });
    expect((await mine(noa)).needs).toEqual(['wheelchair', 'text_first']);
    // Choosing none turns showing off as well.
    await setNeeds(noa, [], true);
    expect(await mine(noa)).toEqual({ needs: [], show: false });
  });

  it('deletes them when the consent is withdrawn, and exports them while it lasts', async () => {
    const noa = await woman();
    const dan = await man();
    await consent(noa, true);
    await setNeeds(noa, ['deaf_hoh'], true);
    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    const data = JSON.parse(strFromU8(zip['data.json']!));
    expect(data.about).toMatchObject({ accessNeeds: ['deaf_hoh'], showAccessNeeds: true });

    expect((await consent(noa, false)).statusCode).toBe(200);
    expect(await mine(noa)).toEqual({ needs: [], show: false });
    expect(await seenBy(dan, noa)).toEqual([]);
    expect((await mine(noa)).needs).toEqual([]);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().consents.accessibility).toBe(false);
  });
});
