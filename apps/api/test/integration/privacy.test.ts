// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('data export (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, {
      name: 'Noa',
      gender: 'woman',
      interestedIn: ['man'],
      bio: 'Sea and sourdough',
    });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', {
        targetId: dan.id,
        kind: 'like',
        comment: 'Love this!',
      })
    ).json().matchId;
    await api(ctx, noa, 'POST', `/v1/matches/${matchId}/messages`, {
      text: 'My own words',
      clientId: 'noa-own-1',
    });
    await api(ctx, dan, 'POST', `/v1/matches/${matchId}/messages`, {
      text: 'DAN PRIVATE TEXT',
      clientId: 'dan-own-1',
    });
  });

  const download = async (m: Member) =>
    ctx.app.inject({ method: 'GET', url: '/v1/me/export', headers: { cookie: m.cookie } });
  const unpack = (body: Buffer) => {
    const files = unzipSync(new Uint8Array(body));
    return { files, data: JSON.parse(strFromU8(files['data.json']!)) };
  };

  it('contains the member’s own data and files, and nothing that belongs to someone else', async () => {
    // A staff warning with an internal note.
    await ctx.services.dbHandle.pool.query(
      `INSERT INTO moderation_actions (target_id, action, category, reason) VALUES ($1, 'warn', 'spam', 'INTERNAL STAFF NOTE')`,
      [noa.id],
    );
    const res = await download(noa);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="my-data-/);
    const { files, data } = unpack(res.rawPayload);

    expect(data.account.email).toMatch(/^noa-/);
    expect(data.profile.displayName).toBe('Noa');
    expect(data.profile.bio).toBe('Sea and sourdough');
    expect(data.prompts).toHaveLength(1);
    expect(data.consents.map((c: { kind: string }) => c.kind)).toEqual(
      expect.arrayContaining(['terms', 'privacy', 'location']),
    );
    expect(data.approximateLocation.lat).toBeCloseTo(32.08, 1);
    expect(data.likesAndPasses[0]).toMatchObject({
      targetId: dan.id,
      kind: 'like',
      comment: 'Love this!',
    });
    expect(data.matches[0].otherMemberId).toBe(dan.id);
    expect(data.messagesYouSent.map((m: { body: string }) => m.body)).toEqual(['My own words']);
    expect(data.moderationAffectingYou).toEqual([
      expect.objectContaining({ action: 'warn', category: 'spam' }),
    ]);
    expect(files[`photos/${noa.photoId}.webp`]).toBeDefined();
    expect(files[`photos/${dan.photoId}.webp`]).toBeUndefined();

    const all = JSON.stringify(data);
    for (const secret of [
      'DAN PRIVATE TEXT',
      'INTERNAL STAFF NOTE',
      dan.photoId,
      'dan-',
      'token',
      'password',
    ]) {
      expect(all, secret).not.toContain(secret);
    }
    const log = await ctx.services.dbHandle.pool.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'account.exported'`,
    );
    expect(log.rows[0].n).toBe(1);
  });

  it('works while suspended, needs a session, and is limited to 3 per day', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me/export' })).statusCode).toBe(401);
    await ctx.services.dbHandle.pool.query(
      `UPDATE "user" SET status = 'suspended', suspended_reason = 'moderation' WHERE id = $1`,
      [noa.id],
    );
    const codes = [];
    for (let i = 0; i < 4; i += 1) codes.push((await download(noa)).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});
