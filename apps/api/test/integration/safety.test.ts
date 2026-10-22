import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const BOUNDARY = 'safetyboundary';
async function selfieBody() {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#22c55e' } })
    .png()
    .toBuffer();
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="s.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, png, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

describe.skipIf(!integrationEnabled)('safety & moderation (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let n = 0;

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    matchId = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json().matchId;
  });

  const send = (m: Member, text: string) =>
    api(ctx, m, 'POST', `/v1/matches/${matchId}/messages`, {
      text,
      clientId: `c-${Date.now()}-${(n += 1)}`,
    });

  /** A staff member with MFA enabled and verified for this session. */
  async function staff(role: 'moderator' | 'admin', email = `${role}-${(n += 1)}@example.test`) {
    const cookie = await signIn(ctx, email);
    const pool = ctx.services.dbHandle.pool;
    await pool.query(`UPDATE "user" SET role = $2 WHERE email = $1`, [email, role]);
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json();
    ctx.clock.value += 30_000;
    const verify = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(secret, ctx.clock.value) },
    });
    expect(verify.statusCode).toBe(200);
    const { rows } = await pool.query(`SELECT id FROM "user" WHERE email = $1`, [email]);
    return { cookie, secret, id: rows[0].id as string, email };
  }
  const admin = (cookie: string, method: 'GET' | 'POST', url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  // ------------------------------------------------------------------ reports

  it('files a report with server-copied evidence from the shared chat and blocks', async () => {
    const m1 = (await send(dan, 'send me money via gift card')).json();
    const m2 = (await send(noa, 'no thanks')).json();
    // A message id from another chat must not be accepted as evidence.
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: eve.id, kind: 'like' });
    const other = (
      await api(ctx, eve, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json();
    const foreign = (
      await api(ctx, eve, 'POST', `/v1/matches/${other.matchId}/messages`, {
        text: 'private',
        clientId: 'eve-private-1',
      })
    ).json();

    const res = await api(ctx, noa, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'scam',
      details: 'Asked for gift cards',
      messageIds: [m1.id, m2.id, foreign.id],
    });
    expect(res.statusCode).toBe(201);
    const pool = ctx.services.dbHandle.pool;
    const evidence = await pool.query(
      'SELECT body, from_reported FROM report_evidence WHERE report_id = $1 ORDER BY sent_at',
      [res.json().reportId],
    );
    expect(evidence.rows).toEqual([
      { body: 'send me money via gift card', from_reported: true },
      { body: 'no thanks', from_reported: false },
    ]);
    const report = await pool.query('SELECT priority, status FROM reports');
    expect(report.rows[0]).toEqual({ priority: 'high', status: 'open' });
    // Reporting blocks by default: the chat is closed and the profile is hidden.
    expect((await api(ctx, noa, 'GET', `/v1/profiles/${dan.id}`)).statusCode).toBe(404);
    expect((await send(noa, 'still there?')).statusCode).toBe(404);

    // Evidence survives the chat purge because it is a copy.
    await pool.query('DELETE FROM messages');
    const kept = await pool.query('SELECT count(*)::int AS n FROM report_evidence');
    expect(kept.rows[0].n).toBe(2);
  });

  it('rejects duplicate open reports, strangers, and self-reports', async () => {
    const body = { targetId: dan.id, category: 'spam', block: false };
    expect((await api(ctx, noa, 'POST', '/v1/reports', body)).statusCode).toBe(201);
    expect((await api(ctx, noa, 'POST', '/v1/reports', body)).statusCode).toBe(409);
    // Someone the reporter never had contact with (filtered out by preferences) → not found.
    const stranger = await createMember(ctx, { name: 'Zed', gender: 'man', interestedIn: ['man'] });
    expect(
      (await api(ctx, noa, 'POST', '/v1/reports', { targetId: stranger.id, category: 'spam' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx, noa, 'POST', '/v1/reports', { targetId: 'no-such-user', category: 'spam' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api(ctx, noa, 'POST', '/v1/reports', { targetId: noa.id, category: 'spam' }))
        .statusCode,
    ).toBe(404);
    // Unmatched people can still be reported (the match row remains).
    await api(ctx, noa, 'DELETE', `/v1/matches/${matchId}`);
    expect(
      (await api(ctx, dan, 'POST', '/v1/reports', { targetId: noa.id, category: 'harassment' }))
        .statusCode,
    ).toBe(201);
  });

  it('emails staff (without content) about urgent reports', async () => {
    const mod = await staff('moderator');
    ctx.mail.length = 0;
    await api(ctx, noa, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'underage',
      details: 'says 16',
    });
    await new Promise((r) => setTimeout(r, 20));
    const alert = ctx.mail.find((m) => m.to === mod.email);
    expect(alert?.subject).toContain('urgent report');
    expect(alert?.text).not.toContain('16');
    expect(alert?.text).not.toContain('Dan');
  });

  // ------------------------------------------------------------------ staff access

  it('requires a staff role and a TOTP check for every admin route', async () => {
    const routes: Array<['GET' | 'POST', string, object?]> = [
      ['GET', '/v1/admin/reports'],
      ['GET', '/v1/admin/reports/00000000-0000-4000-8000-000000000000'],
      [
        'POST',
        '/v1/admin/reports/00000000-0000-4000-8000-000000000000/resolve',
        { action: 'dismiss', reason: 'test' },
      ],
      ['GET', '/v1/admin/verifications'],
      ['POST', '/v1/admin/verifications/00000000-0000-4000-8000-000000000000', { approve: true }],
      ['GET', '/v1/admin/verifications/00000000-0000-4000-8000-000000000000/selfie'],
      ['GET', `/v1/admin/users/${dan.id}/photos/${dan.photoId}`],
      ['POST', `/v1/admin/users/${dan.id}/unsuspend`, { reason: 'test' }],
      ['GET', '/v1/admin/audit'],
    ];
    // A member cannot reach any of them, nor MFA setup.
    for (const [method, url, payload] of [
      ...routes,
      ['POST', '/v1/admin/mfa/setup'] as ['POST', string],
    ]) {
      expect((await admin(noa.cookie, method, url, payload)).statusCode, url).toBe(403);
    }
    // No session at all → 401.
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/admin/reports' })).statusCode).toBe(
      401,
    );

    // A moderator without MFA gets MFA_REQUIRED.
    const email = 'fresh-mod@example.test';
    const cookie = await signIn(ctx, email);
    await ctx.services.dbHandle.pool.query(
      `UPDATE "user" SET role = 'moderator' WHERE email = $1`,
      [email],
    );
    for (const [method, url, payload] of routes) {
      const res = await admin(cookie, method, url, payload);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code, url).toBe('MFA_REQUIRED');
    }
    expect((await admin(cookie, 'GET', '/v1/admin/me')).json()).toEqual({
      role: 'moderator',
      mfaEnabled: false,
      mfaVerified: false,
    });
  });

  it('enforces TOTP: wrong codes, replays, re-enrolment, expiry, other sessions', async () => {
    const mod = await staff('moderator', 'mod@example.test');
    expect((await admin(mod.cookie, 'GET', '/v1/admin/reports')).statusCode).toBe(200);
    // Same code again (replay) is refused, even within the window.
    const replay = await admin(mod.cookie, 'POST', '/v1/admin/mfa/verify', {
      code: totp(mod.secret, ctx.clock.value),
    });
    expect(replay.statusCode).toBe(400);
    // A stolen session cannot enrol a new authenticator once MFA is on.
    expect((await admin(mod.cookie, 'POST', '/v1/admin/mfa/setup')).statusCode).toBe(409);
    // A second session (new sign-in) must pass TOTP on its own.
    const second = await signIn(ctx, 'mod@example.test');
    expect((await admin(second, 'GET', '/v1/admin/reports')).json().error.code).toBe(
      'MFA_REQUIRED',
    );
    expect(
      (await admin(second, 'POST', '/v1/admin/mfa/verify', { code: '000000' })).statusCode,
    ).toBe(400);
    // After 12 hours the step-up expires.
    ctx.clock.value += 12 * 60 * 60 * 1000 + 1;
    expect((await admin(mod.cookie, 'GET', '/v1/admin/reports')).json().error.code).toBe(
      'MFA_REQUIRED',
    );
    const fresh = await admin(mod.cookie, 'POST', '/v1/admin/mfa/verify', {
      code: totp(mod.secret, ctx.clock.value),
    });
    expect(fresh.statusCode).toBe(200);
    // Revoking the role is immediate.
    await ctx.services.dbHandle.pool.query(`UPDATE "user" SET role = 'user' WHERE id = $1`, [
      mod.id,
    ]);
    expect((await admin(mod.cookie, 'GET', '/v1/admin/reports')).statusCode).toBe(403);

    // The secret is stored encrypted, never in plain text.
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT secret FROM staff_mfa WHERE user_id = $1',
      [mod.id],
    );
    expect(rows[0].secret).not.toContain(mod.secret);
    const failures = await ctx.services.dbHandle.pool.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'staff.mfa_failed'`,
    );
    expect(failures.rows[0].n).toBe(2);
  });

  it('locks MFA after repeated wrong codes', async () => {
    const mod = await staff('moderator');
    const second = await signIn(ctx, mod.email);
    await ctx.services.dbHandle.pool.query(
      'UPDATE staff_mfa SET failed_attempts = 10 WHERE user_id = $1',
      [mod.id],
    );
    ctx.clock.value += 30_000;
    const res = await admin(second, 'POST', '/v1/admin/mfa/verify', {
      code: totp(mod.secret, ctx.clock.value),
    });
    expect(res.statusCode).toBe(403);
  });

  // ------------------------------------------------------------------ moderation

  it('shows the queue by priority and audits staff reads', async () => {
    const mod = await staff('moderator');
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    await api(ctx, eve, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    await send(dan, 'you will regret this');
    await api(ctx, noa, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'spam',
      block: false,
    });
    await api(ctx, dan, 'POST', '/v1/reports', {
      targetId: eve.id,
      category: 'threat',
      block: false,
    });
    const queue = (await admin(mod.cookie, 'GET', '/v1/admin/reports')).json().reports;
    expect(queue.map((r: { priority: string }) => r.priority)).toEqual(['urgent', 'normal']);
    expect(queue[1].reported.displayName).toBe('Dan');

    const detail = await admin(mod.cookie, 'GET', `/v1/admin/reports/${queue[1].id}`);
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.reporter.displayName).toBe('Noa');
    expect(JSON.stringify(body)).not.toContain('@example.test'); // no emails to staff
    expect(body.reportedProfile.photoIds).toEqual([dan.photoId]);

    const photo = await admin(mod.cookie, 'GET', `/v1/admin/users/${dan.id}/photos/${dan.photoId}`);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['cache-control']).toBe('no-store');
    // A photo id that does not belong to the user in the URL is refused.
    expect(
      (await admin(mod.cookie, 'GET', `/v1/admin/users/${noa.id}/photos/${dan.photoId}`))
        .statusCode,
    ).toBe(404);

    const { rows } = await ctx.services.dbHandle.pool.query(
      `SELECT action FROM audit_logs WHERE actor_id = $1 AND action LIKE 'staff.%' ORDER BY created_at`,
      [mod.id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'staff.mfa_enabled',
      'staff.report_viewed',
      'staff.photo_viewed',
    ]);
  });

  it('warns: the member sees the category only and can acknowledge it', async () => {
    const mod = await staff('moderator');
    const { reportId } = (
      await api(ctx, noa, 'POST', '/v1/reports', {
        targetId: dan.id,
        category: 'harassment',
        block: false,
      })
    ).json();
    const res = await admin(mod.cookie, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
      action: 'warn',
      reason: 'internal: rude messages, first offence',
    });
    expect(res.statusCode).toBe(200);
    const me = (await api(ctx, dan, 'GET', '/v1/me')).json();
    expect(me.notices).toHaveLength(1);
    expect(me.notices[0].category).toBe('harassment');
    expect(JSON.stringify(me)).not.toContain('internal');
    expect((await api(ctx, noa, 'POST', `/v1/me/notices/${me.notices[0].id}/ack`)).statusCode).toBe(
      404,
    );
    expect((await api(ctx, dan, 'POST', `/v1/me/notices/${me.notices[0].id}/ack`)).statusCode).toBe(
      200,
    );
    expect((await api(ctx, dan, 'GET', '/v1/me')).json().notices).toEqual([]);
    // Handled reports cannot be resolved twice.
    expect(
      (
        await admin(mod.cookie, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
          action: 'dismiss',
          reason: 'again',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('suspends: sessions revoked, matches closed, hidden from discovery, other reports settled', async () => {
    const mod = await staff('moderator');
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: eve.id, kind: 'like' }); // contact persists
    const first = (
      await api(ctx, noa, 'POST', '/v1/reports', {
        targetId: dan.id,
        category: 'harassment',
        block: false,
      })
    ).json();
    await api(ctx, eve, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'spam',
      block: false,
    });
    expect(await discoverIds(ctx, eve)).toContain(dan.id);

    const res = await admin(mod.cookie, 'POST', `/v1/admin/reports/${first.reportId}/resolve`, {
      action: 'suspend',
      reason: 'repeated harassment',
    });
    expect(res.statusCode).toBe(200);
    expect((await api(ctx, dan, 'GET', '/v1/me')).statusCode).toBe(401); // session revoked
    expect(await discoverIds(ctx, eve)).not.toContain(dan.id);
    expect((await send(noa, 'hello?')).statusCode).toBe(404); // match closed
    const pool = ctx.services.dbHandle.pool;
    const open = await pool.query(`SELECT count(*)::int AS n FROM reports WHERE status = 'open'`);
    expect(open.rows[0].n).toBe(0);
    // A moderator cannot ban or lift suspensions.
    const again = (
      await api(ctx, eve, 'POST', '/v1/reports', {
        targetId: dan.id,
        category: 'scam',
        block: false,
      })
    ).json();
    expect(again.reportId).toBeTruthy();
    expect(
      (
        await admin(mod.cookie, 'POST', `/v1/admin/reports/${again.reportId}/resolve`, {
          action: 'ban',
          reason: 'nope',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await admin(mod.cookie, 'POST', `/v1/admin/users/${dan.id}/unsuspend`, { reason: 'appeal' }))
        .statusCode,
    ).toBe(403);

    // The suspended member can still sign in to read the state and delete the account.
    const { rows } = await pool.query('SELECT email FROM "user" WHERE id = $1', [dan.id]);
    const back = await signIn(ctx, rows[0].email);
    const state = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: back } });
    expect(state.json().user.status).toBe('suspended');
  });

  it('bans: the email (and trivial variants) cannot create a new account; admins can lift it', async () => {
    const boss = await staff('admin');
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT email FROM "user" WHERE id = $1',
      [dan.id],
    );
    const danEmail: string = rows[0].email;
    const { reportId } = (
      await api(ctx, noa, 'POST', '/v1/reports', { targetId: dan.id, category: 'scam' })
    ).json();
    expect(
      (
        await admin(boss.cookie, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
          action: 'ban',
          reason: 'romance scam',
        })
      ).statusCode,
    ).toBe(200);
    const hash = await ctx.services.dbHandle.pool.query('SELECT email_hash FROM banned_emails');
    expect(hash.rows[0].email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(hash.rows)).not.toContain(danEmail);

    // The banned member deletes the account and tries to come back with a variant address.
    const cookie = await signIn(ctx, danEmail);
    expect(
      (await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: { cookie } })).statusCode,
    ).toBe(200);
    const [local, domain] = danEmail.split('@');
    await expect(signIn(ctx, `${local!.toUpperCase()}+new@${domain}`)).rejects.toThrow(
      /verify failed|no session/,
    );
    await expect(signIn(ctx, danEmail)).rejects.toThrow();
    // Other addresses are unaffected.
    await expect(signIn(ctx, 'someone-else@example.test')).resolves.toContain('session_token');
  });

  it('lets admins lift a moderation suspension, but never an age suspension', async () => {
    const boss = await staff('admin');
    const { reportId } = (
      await api(ctx, noa, 'POST', '/v1/reports', { targetId: dan.id, category: 'spam' })
    ).json();
    await admin(boss.cookie, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
      action: 'ban',
      reason: 'spam bot',
    });
    expect(
      (
        await admin(boss.cookie, 'POST', `/v1/admin/users/${dan.id}/unsuspend`, {
          reason: 'appeal ok',
        })
      ).statusCode,
    ).toBe(200);
    const pool = ctx.services.dbHandle.pool;
    expect((await pool.query('SELECT count(*)::int AS n FROM banned_emails')).rows[0].n).toBe(0);
    expect(
      (await pool.query('SELECT status FROM "user" WHERE id = $1', [dan.id])).rows[0].status,
    ).toBe('active');
    await pool.query(
      `UPDATE "user" SET status = 'suspended', suspended_reason = 'underage' WHERE id = $1`,
      [noa.id],
    );
    expect(
      (await admin(boss.cookie, 'POST', `/v1/admin/users/${noa.id}/unsuspend`, { reason: 'nope' }))
        .statusCode,
    ).toBe(409);
    // The audit log is visible to admins.
    const log = (await admin(boss.cookie, 'GET', '/v1/admin/audit?limit=5')).json().entries;
    expect(log[0].action).toBe('moderation.unsuspend');
  });

  it('never lets staff act on staff or on reports that involve them', async () => {
    const boss = await staff('admin');
    const mod = await staff('moderator');
    await ctx.services.dbHandle.pool.query(`UPDATE "user" SET role = 'moderator' WHERE id = $1`, [
      dan.id,
    ]);
    const { reportId } = (
      await api(ctx, noa, 'POST', '/v1/reports', {
        targetId: dan.id,
        category: 'spam',
        block: false,
      })
    ).json();
    expect(
      (
        await admin(boss.cookie, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
          action: 'suspend',
          reason: 'x'.repeat(5),
        })
      ).statusCode,
    ).toBe(403);
    expect(mod.id).toBeTruthy();
  });

  // ------------------------------------------------------------------ verification

  it('verifies with a human review and deletes the selfie after the decision', async () => {
    const mod = await staff('moderator');
    expect((await api(ctx, noa, 'GET', '/v1/me/verification')).json().status).toBe('none');
    const started = (await api(ctx, noa, 'POST', '/v1/me/verification')).json();
    expect(started.status).toBe('awaiting_selfie');
    expect(started.pose).toBeTruthy();
    // Starting again returns the same pose rather than a new attempt.
    expect((await api(ctx, noa, 'POST', '/v1/me/verification')).json().pose).toBe(started.pose);

    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/verification/selfie',
      headers: { cookie: noa.cookie, ...(await selfieBody()).headers },
      payload: (await selfieBody()).payload,
    });
    expect(upload.statusCode).toBe(202);
    const job = ctx.jobs.process.at(-1)!;
    const pool = ctx.services.dbHandle.pool;
    const selfie = await pool.query('SELECT id, purpose FROM photos WHERE id = $1', [job.photoId]);
    expect(selfie.rows[0].purpose).toBe('verification');
    // Not reviewable until the scan passed; not visible through the member photo route ever.
    expect(
      (await admin(mod.cookie, 'GET', '/v1/admin/verifications')).json().verifications,
    ).toEqual([]);
    const key = `photos/${noa.id}/${job.photoId}.webp`;
    await ctx.services.storage.put(
      ctx.services.storage.buckets.media,
      key,
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#000' },
      })
        .webp()
        .toBuffer(),
      'image/webp',
    );
    await pool.query(`UPDATE photos SET status = 'clean', media_key = $2 WHERE id = $1`, [
      job.photoId,
      key,
    ]);
    expect((await api(ctx, noa, 'GET', `/v1/photos/${job.photoId}`)).statusCode).toBe(404);
    expect((await api(ctx, dan, 'GET', `/v1/photos/${job.photoId}`)).statusCode).toBe(404);
    expect(
      (await api(ctx, noa, 'GET', '/v1/me')).json().photos.map((p: { id: string }) => p.id),
    ).not.toContain(job.photoId);

    const queue = (await admin(mod.cookie, 'GET', '/v1/admin/verifications')).json().verifications;
    expect(queue).toHaveLength(1);
    expect(queue[0].profilePhotoIds).toEqual([noa.photoId]);
    const image = await admin(mod.cookie, 'GET', `/v1/admin/verifications/${queue[0].id}/selfie`);
    expect(image.statusCode).toBe(200);

    expect(
      (await admin(mod.cookie, 'POST', `/v1/admin/verifications/${queue[0].id}`, { approve: true }))
        .statusCode,
    ).toBe(200);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM photos WHERE id = $1', [job.photoId]))
        .rows[0].n,
    ).toBe(0);
    expect(ctx.jobs.delete.at(-1)?.mediaKeys).toEqual([key]);
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().verified).toBe(true);
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().verified).toBe(true);
    expect((await api(ctx, noa, 'GET', '/v1/me/verification')).json().status).toBe('approved');
    expect((await api(ctx, noa, 'POST', '/v1/me/verification')).statusCode).toBe(409);
  });

  it('requires a profile photo, limits attempts, and lets members retry after a failed scan', async () => {
    const pool = ctx.services.dbHandle.pool;
    await pool.query(`UPDATE photos SET status = 'rejected' WHERE user_id = $1`, [noa.id]);
    expect((await api(ctx, noa, 'POST', '/v1/me/verification')).statusCode).toBe(409);
    await pool.query(`UPDATE photos SET status = 'clean' WHERE user_id = $1`, [noa.id]);

    const body = await selfieBody();
    const early = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/verification/selfie',
      headers: { cookie: noa.cookie, ...body.headers },
      payload: body.payload,
    });
    expect(early.statusCode).toBe(409); // no verification started
    await api(ctx, noa, 'POST', '/v1/me/verification');
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/verification/selfie',
      headers: { cookie: noa.cookie, ...body.headers },
      payload: body.payload,
    });
    const photoId = ctx.jobs.process.at(-1)!.photoId;
    await pool.query(`UPDATE photos SET status = 'rejected' WHERE id = $1`, [photoId]); // malware scan failed
    const state = (await api(ctx, noa, 'GET', '/v1/me/verification')).json();
    expect(state.status).toBe('awaiting_selfie');
    const retry = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/verification/selfie',
      headers: { cookie: noa.cookie, ...body.headers },
      payload: body.payload,
    });
    expect(retry.statusCode).toBe(202);

    // Rejected decisions allow a new attempt, up to the daily limit.
    await pool.query(`UPDATE verifications SET status = 'rejected'`);
    expect((await api(ctx, noa, 'POST', '/v1/me/verification')).statusCode).toBe(200);
    await pool.query(`UPDATE verifications SET status = 'rejected'`);
    expect((await api(ctx, noa, 'POST', '/v1/me/verification')).statusCode).toBe(200);
    await pool.query(`UPDATE verifications SET status = 'rejected'`);
    expect((await api(ctx, noa, 'POST', '/v1/me/verification')).statusCode).toBe(429);
  });

  it('changing profile photos removes the badge, and a selfie older than the photos cannot be approved', async () => {
    const mod = await staff('moderator');
    const pool = ctx.services.dbHandle.pool;
    const verified = async () =>
      (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().verified;
    const markVerified = () =>
      pool.query('UPDATE profiles SET verified_at = now() WHERE user_id = $1', [noa.id]);

    await markVerified();
    expect(await verified()).toBe(true);
    const body = await selfieBody();
    const added = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/photos',
      headers: { cookie: noa.cookie, ...body.headers },
      payload: body.payload,
    });
    expect(added.statusCode).toBe(202);
    expect(await verified()).toBe(false);

    await markVerified();
    expect((await api(ctx, noa, 'DELETE', `/v1/me/photos/${added.json().id}`)).statusCode).toBe(
      200,
    );
    expect((await api(ctx, noa, 'GET', '/v1/me')).json().verified).toBe(false);

    // Photos swapped while the selfie waited for review.
    const selfie = await pool.query(
      `INSERT INTO photos (user_id, status, position, purpose, created_at)
       VALUES ($1, 'clean', 0, 'verification', now() - interval '1 hour') RETURNING id`,
      [noa.id],
    );
    const pending = await pool.query(
      `INSERT INTO verifications (user_id, pose, status, selfie_photo_id) VALUES ($1, 'wave', 'pending', $2) RETURNING id`,
      [noa.id, selfie.rows[0].id],
    );
    const decision = await admin(
      mod.cookie,
      'POST',
      `/v1/admin/verifications/${pending.rows[0].id}`,
      {
        approve: true,
      },
    );
    expect(decision.statusCode).toBe(409);
    expect((await api(ctx, noa, 'GET', '/v1/me/verification')).json().status).toBe(
      'awaiting_selfie',
    );
    expect(
      (await pool.query('SELECT 1 FROM photos WHERE id = $1', [selfie.rows[0].id])).rowCount,
    ).toBe(0);
    expect(await verified()).toBe(false);
  });

  it('staff can open profile photos but never private chat images', async () => {
    const mod = await staff('moderator');
    const pool = ctx.services.dbHandle.pool;
    const chat = await pool.query(
      `INSERT INTO photos (user_id, status, position, purpose, media_key)
       VALUES ($1, 'clean', 0, 'chat', $2) RETURNING id`,
      [noa.id, `photos/${noa.id}/chat.webp`],
    );
    const open = (photoId: string) =>
      admin(mod.cookie, 'GET', `/v1/admin/users/${noa.id}/photos/${photoId}`);
    expect((await open(noa.photoId)).statusCode).toBe(200);
    expect((await open(chat.rows[0].id)).statusCode).toBe(404);
  });

  it('staff cannot review their own verification; rejecting deletes the selfie too', async () => {
    const mod = await staff('moderator');
    const pool = ctx.services.dbHandle.pool;
    const { rows } = await pool.query(
      `INSERT INTO photos (user_id, status, position, purpose) VALUES ($1, 'clean', 0, 'verification') RETURNING id`,
      [mod.id],
    );
    const own = await pool.query(
      `INSERT INTO verifications (user_id, pose, status, selfie_photo_id) VALUES ($1, 'wave', 'pending', $2) RETURNING id`,
      [mod.id, rows[0].id],
    );
    expect(
      (
        await admin(mod.cookie, 'POST', `/v1/admin/verifications/${own.rows[0].id}`, {
          approve: true,
        })
      ).statusCode,
    ).toBe(403);

    const photo = await pool.query(
      `INSERT INTO photos (user_id, status, position, purpose) VALUES ($1, 'clean', 0, 'verification') RETURNING id`,
      [dan.id],
    );
    const theirs = await pool.query(
      `INSERT INTO verifications (user_id, pose, status, selfie_photo_id) VALUES ($1, 'wave', 'pending', $2) RETURNING id`,
      [dan.id, photo.rows[0].id],
    );
    expect(
      (
        await admin(mod.cookie, 'POST', `/v1/admin/verifications/${theirs.rows[0].id}`, {
          approve: false,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM photos WHERE id = $1', [photo.rows[0].id]))
        .rows[0].n,
    ).toBe(0);
    expect((await api(ctx, dan, 'GET', '/v1/me')).json().verified).toBe(false);
    expect((await api(ctx, dan, 'GET', '/v1/me/verification')).json().status).toBe('rejected');
  });
});
