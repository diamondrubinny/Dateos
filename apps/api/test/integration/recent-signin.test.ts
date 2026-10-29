// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { RECENT_SIGN_IN_MINUTES } from '@nexaheart/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('recent sign-in for sensitive actions (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
  });
  /** Noa's sessions signed in this many minutes ago. */
  const age = (minutes: number) =>
    q(`UPDATE session SET created_at = now() - make_interval(mins => $2) WHERE user_id = $1`, [
      noa.id,
      minutes,
    ]);

  it('an old session can’t delete the account or move it to another mailbox', async () => {
    await age(RECENT_SIGN_IN_MINUTES + 5);
    const deleted = await api(ctx, noa, 'DELETE', '/v1/me');
    expect(deleted.statusCode).toBe(403);
    expect(deleted.json().error.code).toBe('REAUTH_REQUIRED');
    const moved = await api(ctx, noa, 'POST', '/v1/me/email', { email: 'elsewhere@example.test' });
    expect(moved.statusCode).toBe(403);
    expect(moved.json().error.code).toBe('REAUTH_REQUIRED');
    // Nothing happened, and everyday actions still work.
    expect((await api(ctx, noa, 'GET', '/v1/me')).statusCode).toBe(200);
    expect(ctx.mail.filter((m) => m.to === 'elsewhere@example.test')).toHaveLength(0);
  });

  it('a fresh sign-in can', async () => {
    await age(RECENT_SIGN_IN_MINUTES + 5);
    const email = (await api(ctx, noa, 'GET', '/v1/me')).json().user.email as string;
    const fresh = await signIn(ctx, email);
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { cookie: fresh },
    });
    expect(res.statusCode).toBe(200);
  });

  it('within the window, nothing changes for the member', async () => {
    await age(RECENT_SIGN_IN_MINUTES - 5);
    expect((await api(ctx, noa, 'DELETE', '/v1/me')).statusCode).toBe(200);
  });
});
