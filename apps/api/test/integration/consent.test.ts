import { SENSITIVE_CONSENT_VERSION } from '@dateos/shared';
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
