// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const sha = (n: number) => n.toString(16).padStart(40, '0');
const CURRENT = sha(1);
const LATEST = sha(3);

/** GitHub's compare answer: two merged pull requests since CURRENT. */
const ahead = {
  status: 'ahead',
  ahead_by: 3,
  commits: [
    {
      sha: sha(2),
      commit: { message: 'Phase 53: updates', committer: { date: '2026-10-29T20:00:00Z' } },
    },
    {
      sha: sha(4),
      commit: {
        message: 'Merge pull request #61 from o/b\n\nPhase 52: email the admins when backups stop',
        committer: { date: '2026-10-29T21:00:00Z' },
      },
    },
    {
      sha: LATEST,
      commit: {
        message: 'Merge pull request #62 from o/c\n\nPhase 53: updates from GitHub',
        committer: { date: '2026-10-29T22:00:00Z' },
      },
    },
  ],
};

describe.skipIf(!integrationEnabled)('updates from GitHub (integration)', () => {
  let ctx: TestContext;
  let n = 0;
  let requested: string[];
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);

  async function staff(role: 'moderator' | 'admin') {
    const email = `updates-${role}-${(n += 1)}@example.test`;
    const cookie = await signIn(ctx, email);
    await q(`UPDATE "user" SET role = $2 WHERE email = $1`, [email, role]);
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    ctx.clock.value += 30_000;
    const verify = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });
    expect(verify.statusCode).toBe(200);
    return cookie;
  }
  const call = (cookie: string, method: 'GET' | 'POST', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  /** GitHub, as seen by the check: answers `body` and remembers what was asked. */
  const github = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(String(url));
      return new Response(JSON.stringify(body), { status });
    });

  beforeAll(async () => {
    ctx = await setupIntegration({ appCommit: CURRENT });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    await q('DELETE FROM update_requests');
    await q('DELETE FROM update_status');
    requested = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('before any check: the running version and nothing to install', async () => {
    const s = (await call(await staff('admin'), 'GET', '/v1/admin/updates')).json();
    expect(s).toMatchObject({
      enabled: true,
      repo: 'diamondrubinny/NexaHeart',
      branch: 'main',
      current: CURRENT,
      checkedAt: null,
      latest: null,
      behind: 0,
      changes: [],
      request: null,
    });
  });

  it('"Check now" lists what is new, from the merged pull requests', async () => {
    const admin = await staff('admin');
    github(200, ahead);
    const s = (await call(admin, 'POST', '/v1/admin/updates/check')).json();
    expect(requested).toEqual([
      `https://api.github.com/repos/diamondrubinny/NexaHeart/compare/${CURRENT}...main`,
    ]);
    expect(s).toMatchObject({ latest: LATEST, behind: 3, error: null });
    expect(s.changes).toEqual([
      { title: 'Phase 53: updates from GitHub', number: 62, at: '2026-10-29T22:00:00Z' },
      {
        title: 'Phase 52: email the admins when backups stop',
        number: 61,
        at: '2026-10-29T21:00:00Z',
      },
    ]);
  });

  it('a failed check keeps the last good result and says why', async () => {
    const admin = await staff('admin');
    github(200, ahead);
    await call(admin, 'POST', '/v1/admin/updates/check');
    github(403, { message: 'rate limited' });
    const s = (await call(admin, 'POST', '/v1/admin/updates/check')).json();
    expect(s).toMatchObject({ latest: LATEST, behind: 3 });
    expect(s.error).toContain('rate limit');
  });

  it('approving records one request for exactly the latest commit, audited', async () => {
    const admin = await staff('admin');
    github(200, ahead);
    await call(admin, 'POST', '/v1/admin/updates/check');
    // Only the commit the check found.
    expect(
      (await call(admin, 'POST', '/v1/admin/updates/install', { commit: sha(4) })).statusCode,
    ).toBe(409);
    expect(
      (await call(admin, 'POST', '/v1/admin/updates/install', { commit: 'main' })).statusCode,
    ).toBe(400);
    const ok = await call(admin, 'POST', '/v1/admin/updates/install', { commit: LATEST });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().request).toMatchObject({ status: 'pending', target: LATEST, from: CURRENT });
    // One at a time.
    const again = await call(admin, 'POST', '/v1/admin/updates/install', { commit: LATEST });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toBe('An update is already waiting or running.');
    const { rows } = await q(`SELECT action, meta FROM audit_logs WHERE action = 'update.approve'`);
    expect(rows).toEqual([
      { action: 'update.approve', meta: { from: CURRENT, to: LATEST, behind: 3 } },
    ]);
  });

  it('a waiting approval can be withdrawn; one that started cannot', async () => {
    const admin = await staff('admin');
    github(200, ahead);
    await call(admin, 'POST', '/v1/admin/updates/check');
    const id = (await call(admin, 'POST', '/v1/admin/updates/install', { commit: LATEST })).json()
      .request.id;
    expect(
      (await call(admin, 'POST', `/v1/admin/updates/${id}/cancel`)).json().request.status,
    ).toBe('cancelled');
    const id2 = (await call(admin, 'POST', '/v1/admin/updates/install', { commit: LATEST })).json()
      .request.id;
    await q(`UPDATE update_requests SET status = 'running' WHERE id = $1`, [id2]);
    expect((await call(admin, 'POST', `/v1/admin/updates/${id2}/cancel`)).statusCode).toBe(409);
  });

  it('nothing to install when up to date', async () => {
    const admin = await staff('admin');
    github(200, { status: 'identical', ahead_by: 0, commits: [] });
    const s = (await call(admin, 'POST', '/v1/admin/updates/check')).json();
    expect(s).toMatchObject({ latest: CURRENT, behind: 0 });
    expect(
      (await call(admin, 'POST', '/v1/admin/updates/install', { commit: CURRENT })).statusCode,
    ).toBe(409);
  });

  it('approving needs a recent sign-in; moderators and members can’t see or approve', async () => {
    const admin = await staff('admin');
    github(200, ahead);
    await call(admin, 'POST', '/v1/admin/updates/check');
    await q(`UPDATE session SET created_at = now() - interval '1 hour'`);
    const stale = await call(admin, 'POST', '/v1/admin/updates/install', { commit: LATEST });
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error.code).toBe('REAUTH_REQUIRED');
    const mod = await staff('moderator');
    expect((await call(mod, 'GET', '/v1/admin/updates')).statusCode).toBe(403);
    expect(
      (await call(mod, 'POST', '/v1/admin/updates/install', { commit: LATEST })).statusCode,
    ).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/admin/updates' })).statusCode).toBe(
      401,
    );
  });
});

describe.skipIf(!integrationEnabled)('updates on a server whose version is unknown', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));

  it('says so, and never asks GitHub', async () => {
    await resetState(ctx);
    const email = 'updates-unknown@example.test';
    const cookie = await signIn(ctx, email);
    await ctx.services.dbHandle.pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [
      email,
    ]);
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    ctx.clock.value += 30_000;
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      return new Response('{}');
    });
    const s = (
      await ctx.app.inject({ method: 'POST', url: '/v1/admin/updates/check', headers: { cookie } })
    ).json();
    vi.unstubAllGlobals();
    expect(asked).toEqual([]);
    expect(s).toMatchObject({ current: null, error: 'unknown-version', behind: 0 });
  });
});
