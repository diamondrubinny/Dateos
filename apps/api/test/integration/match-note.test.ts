// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { SENSITIVE_CONSENT_VERSION } from '@nexaheart/shared';
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

const NOTE = 'I use a wheelchair, so I pick places with step-free access.\nHappy to explain more.';

describe.skipIf(!integrationEnabled)('Match Note, phase 66b (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let eli: Member;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
  });

  const setNote = (m: Member, note: string | null) =>
    api(ctx, m, 'PUT', '/v1/me/match-note', { note });
  const noteSeenBy = async (viewer: Member) =>
    (await api(ctx, viewer, 'GET', `/v1/profiles/${noa.id}`)).json().matchNote ?? null;
  async function match(a: Member, b: Member): Promise<string> {
    await api(ctx, a, 'POST', '/v1/interactions', { targetId: b.id, kind: 'like' });
    return (await api(ctx, b, 'POST', '/v1/interactions', { targetId: a.id, kind: 'like' })).json()
      .matchId;
  }

  it('saved with line breaks, cleared; plain, kind words only', async () => {
    expect((await setNote(noa, NOTE)).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().matchNote).toBe(NOTE);
    for (const bad of ['<b>hi</b>', 'x'.repeat(501), '   ', 'You are all idiots']) {
      expect((await setNote(noa, bad)).statusCode).toBe(400);
    }
    expect((await setNote(noa, null)).statusCode).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().matchNote).toBeNull();
  });

  it('needs the sensitive-data consent', async () => {
    await api(ctx, noa, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'sensitive', granted: false, version: SENSITIVE_CONSENT_VERSION }],
    });
    expect((await setNote(noa, NOTE)).statusCode).toBe(403);
  });

  it('only matches see it, while the match lasts; never the preview', async () => {
    await setNote(noa, NOTE);
    expect(await noteSeenBy(eli)).toBeNull();
    expect(await noteSeenBy(dan)).toBeNull(); // not matched yet
    const matchId = await match(dan, noa);
    expect(await noteSeenBy(dan)).toBe(NOTE);
    expect(await noteSeenBy(eli)).toBeNull();
    const preview = (await api(ctx, noa, 'GET', '/v1/me/preview')).json();
    expect(preview.profile.matchNote ?? null).toBeNull();
    await api(ctx, dan, 'DELETE', `/v1/matches/${matchId}`);
    const after = await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`);
    expect(after.statusCode === 404 || (after.json().matchNote ?? null) === null).toBe(true);
  });

  it('in "Download my data"', async () => {
    await setNote(noa, NOTE);
    const zip = await api(ctx, noa, 'GET', '/v1/me/export');
    const data = JSON.parse(strFromU8(unzipSync(new Uint8Array(zip.rawPayload))['data.json']!));
    expect(data.about).toMatchObject({ matchNote: NOTE });
  });
});
