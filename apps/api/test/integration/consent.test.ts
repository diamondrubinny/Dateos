import { SENSITIVE_CONSENT_VERSION } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  validProfile,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('sensitive-data consent (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const sensitive = (m: Member, granted: boolean) =>
    api(ctx, m, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'sensitive', granted, version: SENSITIVE_CONSENT_VERSION }],
    });
  const status = async (m: Member) =>
    (await ctx.services.dbHandle.pool.query('SELECT status FROM "user" WHERE id = $1', [m.id]))
      .rows[0].status as string;

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  it('no profile (gender, interests) is stored before the consents', async () => {
    const cookie = await signIn(ctx, 'new@example.test');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: validProfile,
    });
    expect(res.statusCode).toBe(403);
    const { rows } = await ctx.services.dbHandle.pool.query(
      `SELECT count(*)::int AS n FROM profiles p JOIN "user" u ON u.id = p.user_id WHERE u.email = 'new@example.test'`,
    );
    expect(rows[0].n).toBe(0);
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.json().onboarding.missing[0]).toBe('consents');
  });

  it('withdrawing hides the profile both ways until consent is given again', async () => {
    expect(await discoverIds(ctx, dan)).toContain(noa.id);

    expect((await sensitive(noa, false)).statusCode).toBe(200);
    expect(await status(noa)).toBe('paused');
    expect(await discoverIds(ctx, dan)).not.toContain(noa.id);
    expect(await discoverIds(ctx, noa)).toEqual([]);
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(404);
    const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
    expect(me.onboarding.missing).toContain('consents');
    // Changing gender or interests is not possible without consent.
    expect(
      (await api(ctx, noa, 'PATCH', '/v1/me/profile', { interestedIn: ['man', 'woman'] }))
        .statusCode,
    ).toBe(403);
    // Other edits and data rights still work.
    expect((await api(ctx, noa, 'PATCH', '/v1/me/profile', { bio: 'Still here' })).statusCode).toBe(
      200,
    );

    expect((await sensitive(noa, true)).statusCode).toBe(200);
    expect(await status(noa)).toBe('active');
    expect(await discoverIds(ctx, dan)).toContain(noa.id);
  });

  it('a paused member cannot like or match, and sees no likes', async () => {
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await sensitive(noa, false);
    expect((await api(ctx, noa, 'GET', '/v1/likes')).json().likes).toEqual([]);
    const like = await api(ctx, noa, 'POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    expect(like.statusCode).toBe(403);
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT count(*)::int AS n FROM matches',
    );
    expect(rows[0].n).toBe(0);
  });

  it('withdrawing location consent deletes the stored location', async () => {
    const res = await api(ctx, noa, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'location', granted: false, version: '1' }],
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT count(*)::int AS n FROM locations WHERE user_id = $1',
      [noa.id],
    );
    expect(rows[0].n).toBe(0);
    expect(await discoverIds(ctx, dan)).not.toContain(noa.id);
  });

  it('one decision per consent kind per request', async () => {
    const res = await api(ctx, noa, 'PUT', '/v1/me/consents', {
      consents: [
        { kind: 'sensitive', granted: true, version: SENSITIVE_CONSENT_VERSION },
        { kind: 'sensitive', granted: false, version: SENSITIVE_CONSENT_VERSION },
      ],
    });
    expect(res.statusCode).toBe(400);
  });

  it('parallel likes cannot pass the daily limit', async () => {
    const pool = ctx.services.dbHandle.pool;
    // 297 interactions today with throwaway accounts, so exactly 3 more are allowed.
    await pool.query(
      `INSERT INTO "user" (id, email) SELECT 'filler-' || n, 'filler-' || n || '@example.test' FROM generate_series(1, 297) n`,
    );
    await pool.query(
      `INSERT INTO interactions (actor_id, target_id, kind) SELECT $1, 'filler-' || n, 'pass' FROM generate_series(1, 297) n`,
      [noa.id],
    );
    const targets = [dan];
    for (let i = 0; i < 7; i += 1) {
      targets.push(
        await createMember(ctx, { name: `Man${i}`, gender: 'man', interestedIn: ['woman'] }),
      );
    }
    const results = await Promise.all(
      targets.map((t) =>
        api(ctx, noa, 'POST', '/v1/interactions', { targetId: t.id, kind: 'pass' }),
      ),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(3);
    expect(codes.filter((c) => c === 429)).toHaveLength(5);
  });

  it('giving consent again never lifts a suspension', async () => {
    await ctx.services.dbHandle.pool.query(
      `UPDATE "user" SET status = 'suspended', suspended_reason = 'moderation' WHERE id = $1`,
      [noa.id],
    );
    await sensitive(noa, false);
    await sensitive(noa, true);
    expect(await status(noa)).toBe('suspended');
  });
});
