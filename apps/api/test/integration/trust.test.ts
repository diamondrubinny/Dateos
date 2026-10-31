// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash } from 'node:crypto';
import { normalizeEmail } from '@nexaheart/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processPhoto, type JobContext } from '../../../worker/src/jobs.js';
import { processSignupRetention } from '../../../worker/src/signup-jobs.js';
import type { AuthUser } from '../../src/auth/session.js';
import { api, createMember, discoverIds, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const BOUNDARY = 'trust-boundary';
function multipart(file: Buffer) {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="me.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, file, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** A photo-like picture with texture, different for every seed. */
const photo = (seed: number) =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100">
      <filter id="f"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="5" seed="${seed}"/></filter>
      <rect width="100%" height="100%" filter="url(#f)"/></svg>`),
  )
    .jpeg({ quality: 90 })
    .toBuffer();

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe.skipIf(!integrationEnabled)('trust and safety (integration)', () => {
  let ctx: TestContext;
  let worker: JobContext;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const emailOf = async (m: Member) =>
    (await q(`SELECT email FROM "user" WHERE id = $1`, [m.id])).rows[0].email as string;
  const woman = (name = 'Noa') =>
    createMember(ctx, { name, gender: 'woman', interestedIn: ['man'] });
  const man = (name = 'Dan') => createMember(ctx, { name, gender: 'man', interestedIn: ['woman'] });

  /** Uploads a profile photo and runs the worker on it, like production. */
  async function uploadAndProcess(m: Member, image: Buffer): Promise<string> {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/photos',
      headers: { cookie: m.cookie, ...multipart(image).headers },
      payload: multipart(image).payload,
    });
    expect(res.statusCode).toBe(202);
    return processPhoto(worker, ctx.jobs.process.at(-1)!);
  }

  async function admin(): Promise<AuthUser> {
    const email = `admin-${(n += 1)}@example.test`;
    await signIn(ctx, email);
    const { rows } = await q(`UPDATE "user" SET role = 'admin' WHERE email = $1 RETURNING id`, [
      email,
    ]);
    return {
      id: rows[0].id,
      email,
      role: 'admin',
      status: 'active',
      sessionId: 'test',
      signedInAt: Date.now(),
    };
  }

  async function setSignup(mode: 'open' | 'invite' | 'waitlist', memberInvites = false) {
    await q(
      `INSERT INTO instance_settings (id, signup_mode, member_invites) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET signup_mode = $1, member_invites = $2`,
      [mode, memberInvites],
    );
    ctx.services.instance.invalidate();
  }
  const requestLink = (email: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/magic-link',
      headers: { origin: 'http://localhost:8081' },
      payload: { email, callbackURL: 'http://localhost:8081/' },
    });
  const settle = () => new Promise((r) => setTimeout(r, 30));

  beforeAll(async () => {
    ctx = await setupIntegration();
    worker = {
      db: ctx.services.dbHandle.db,
      storage: ctx.services.storage,
      scanner: { scan: async () => ({ clean: true }) },
      scanningEnabled: true,
      log: { warn: () => undefined, info: () => undefined } as never,
    };
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => resetState(ctx));

  // ------------------------------------------------------------------ duplicate photos

  it('opens an automatic case when a profile photo copies another member’s', async () => {
    const noa = await woman();
    const copycat = await woman('Copy');
    const image = await photo(11);
    expect(await uploadAndProcess(noa, image)).toBe('clean');
    // The same picture, smaller and re-compressed, on another account.
    const copy = await sharp(image).resize(500).jpeg({ quality: 60 }).toBuffer();
    expect(await uploadAndProcess(copycat, copy)).toBe('clean');
    const { rows } = await q(
      `SELECT reporter_id, category, priority, automatic, details FROM reports WHERE reported_id = $1`,
      [copycat.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporter_id: null,
      category: 'fake_profile',
      priority: 'normal',
      automatic: true,
    });
    expect(rows[0].details).toContain(noa.id);
    // A different photo opens nothing; a second copy doesn't open a second case.
    expect(await uploadAndProcess(noa, await photo(12))).toBe('clean');
    expect(await uploadAndProcess(copycat, image)).toBe('clean');
    expect((await q(`SELECT 1 FROM reports`)).rows).toHaveLength(1);
    expect(
      (await q(`SELECT 1 FROM audit_logs WHERE action = 'report.automatic'`)).rows,
    ).toHaveLength(1);
  });

  it('keeps a banned account’s photos out of new accounts until the ban is lifted', async () => {
    const banned = await man('Ban');
    const reporter = await woman();
    const image = await photo(21);
    expect(await uploadAndProcess(banned, image)).toBe('clean');
    const { rows } = await q(
      `INSERT INTO reports (reporter_id, reported_id, category, priority) VALUES ($1, $2, 'scam', 'high') RETURNING id`,
      [reporter.id, banned.id],
    );
    const staff = await admin();
    await ctx.services.moderation.resolve(staff, rows[0].id, 'ban', 'Scam ring');
    expect((await q(`SELECT user_id FROM banned_photo_hashes`)).rows).toEqual([
      { user_id: banned.id },
    ]);

    // The same photo on a new account is rejected and flagged (high priority).
    const again = await man('Again');
    const brighter = await sharp(image).modulate({ brightness: 1.1 }).jpeg().toBuffer();
    expect(await uploadAndProcess(again, brighter)).toBe('rejected');
    const photoRow = (
      await q(
        `SELECT status, reject_reason FROM photos WHERE user_id = $1 ORDER BY created_at DESC`,
        [again.id],
      )
    ).rows[0];
    expect(photoRow).toEqual({ status: 'rejected', reject_reason: 'banned_photo' });
    const flagged = await q(`SELECT priority, automatic FROM reports WHERE reported_id = $1`, [
      again.id,
    ]);
    expect(flagged.rows).toEqual([{ priority: 'high', automatic: true }]);

    // Lifting the ban removes the hashes too.
    await ctx.services.moderation.liftSuspension(staff, banned.id, 'Appeal accepted');
    expect((await q(`SELECT 1 FROM banned_photo_hashes`)).rows).toHaveLength(0);
  });

  it('phase 73b: a photo like one a partner banned is published and reviewed, never rejected', async () => {
    // The hash a partner would send: of a photo nobody here uses any more.
    const source = await woman('Source');
    const image = await photo(31);
    expect(await uploadAndProcess(source, image)).toBe('clean');
    const hash = (
      await q(`SELECT phash::text AS h FROM photos WHERE user_id = $1 AND phash IS NOT NULL`, [
        source.id,
      ])
    ).rows[0].h as string;
    await q(`DELETE FROM photos WHERE user_id = $1`, [source.id]);
    const partner = (
      await q(`INSERT INTO federation_partners (url, name, public_key, status)
        VALUES ('https://api.partner.example.test', 'Rainbow Haifa', 'k', 'active') RETURNING id`)
    ).rows[0].id;
    await q(
      `INSERT INTO federation_signals_in (partner_id, signal_id, hash, category)
       VALUES ($1, gen_random_uuid(), $2::bigint, 'scam')`,
      [partner, hash],
    );
    const copy = await sharp(image).modulate({ brightness: 1.1 }).jpeg().toBuffer();

    // Sharing off here: the signal isn't used (and the nightly cleanup would delete it).
    const first = await man('First');
    expect(await uploadAndProcess(first, copy)).toBe('clean');
    expect((await q(`SELECT 1 FROM reports WHERE reported_id = $1`, [first.id])).rows).toEqual([]);

    // Sharing on: the photo is still published, and moderators get a case to review.
    await q(`INSERT INTO instance_settings (id, share_trust_signals) VALUES (1, true)
      ON CONFLICT (id) DO UPDATE SET share_trust_signals = true`);
    const second = await man('Second');
    expect(await uploadAndProcess(second, copy)).toBe('clean');
    const { rows } = await q(
      `SELECT priority, automatic, details FROM reports WHERE reported_id = $1`,
      [second.id],
    );
    // Two separate cases: the copy of First's photo (as before), and the partner's signal, which
    // another kind of automatic case doesn't hide.
    expect(rows).toHaveLength(2);
    const signal = rows.find((r) => String(r.details).includes('partner community'))!;
    expect(signal).toMatchObject({ priority: 'high', automatic: true });
    expect(signal.details).toContain('“Rainbow Haifa” banned (scam)');
    expect(rows.find((r) => r !== signal)!.priority).toBe('normal');
    expect(
      (
        await q(
          `SELECT meta FROM audit_logs WHERE action = 'report.automatic' AND target_id = $1`,
          [second.id],
        )
      ).rows[0].meta,
    ).toEqual({ reason: 'partner_signal' });
  });

  it('gives a flat image no hash, so it never matches anything', async () => {
    const noa = await woman();
    const flat = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#7c3aed' },
    })
      .jpeg()
      .toBuffer();
    expect(await uploadAndProcess(noa, flat)).toBe('clean');
    const { rows } = await q(
      `SELECT phash FROM photos WHERE user_id = $1 AND media_key LIKE '%' ORDER BY created_at DESC LIMIT 1`,
      [noa.id],
    );
    expect(rows[0].phash).toBeNull();
  });

  // ------------------------------------------------------------------ hide me from my contacts

  it('hides contacts both ways, silently, storing only the matches', async () => {
    const noa = await woman();
    const dan = await man();
    const other = await man('Gil');
    expect(await discoverIds(ctx, noa)).toEqual(expect.arrayContaining([dan.id, other.id]));

    const danEmail = await emailOf(dan);
    // Contacts often hold variants of an address; hashes are of the normalized form.
    const variant = danEmail.replace('@', '+work@').toUpperCase();
    const res = await api(ctx, noa, 'POST', '/v1/me/contact-hides', {
      hashes: [sha256(normalizeEmail(variant)), sha256('nobody@example.test'), 'a'.repeat(64)],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hidden: 1 });
    expect((await q(`SELECT user_id, other_id FROM contact_hides`)).rows).toEqual([
      { user_id: noa.id, other_id: dan.id },
    ]);
    expect(await discoverIds(ctx, noa)).not.toContain(dan.id);
    expect(await discoverIds(ctx, dan)).not.toContain(noa.id);
    expect(await discoverIds(ctx, noa)).toContain(other.id);
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(404);

    // Validation, and undoing it.
    expect(
      (await api(ctx, noa, 'POST', '/v1/me/contact-hides', { hashes: ['not-a-hash'] })).statusCode,
    ).toBe(400);
    expect(
      (
        await api(ctx, noa, 'POST', '/v1/me/contact-hides', {
          hashes: Array.from({ length: 2001 }, (_, i) => sha256(String(i))),
        })
      ).statusCode,
    ).toBe(400);
    expect((await api(ctx, noa, 'DELETE', '/v1/me/contact-hides')).json()).toEqual({ hidden: 0 });
    expect(await discoverIds(ctx, noa)).toContain(dan.id);
  });

  it('leaves an existing match alone', async () => {
    const noa = await woman();
    const dan = await man();
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' });
    await api(ctx, noa, 'POST', '/v1/me/contact-hides', {
      hashes: [sha256(normalizeEmail(await emailOf(dan)))],
    });
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).statusCode).toBe(200);
  });

  // ------------------------------------------------------------------ invite codes

  it('invite mode: a code lets one address join; others get a "how to join" email', async () => {
    const existing = await woman();
    const staff = await admin();
    await setSignup('invite');

    // A new address gets no link, but the response is the same.
    const before = ctx.mail.length;
    expect((await requestLink('new@example.test')).statusCode).toBe(200);
    await settle();
    const sent = ctx.mail.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('invite code');
    expect(sent[0]!.text).not.toMatch(/magic-link\/verify/);

    // Members already here keep signing in as usual.
    expect(await signIn(ctx, await emailOf(existing))).toContain('session_token');

    const invite = await ctx.services.trust.createInvite(staff, {
      label: 'Launch party',
      maxUses: 1,
      expiresInDays: 30,
    });
    expect(invite.code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    const stored = (await q(`SELECT code_hash FROM invite_codes`)).rows[0].code_hash;
    expect(stored).not.toContain(invite.code);

    const redeem = (code: string, email: string) =>
      ctx.app.inject({ method: 'POST', url: '/v1/signup/redeem', payload: { code, email } });
    expect((await redeem('WRONG-CODE', 'new@example.test')).statusCode).toBe(400);
    // Codes are forgiving about case, spaces and dashes.
    const typed = `${invite.code!.slice(0, 5).toLowerCase()}-${invite.code!.slice(5)}`;
    expect((await redeem(typed, 'new@example.test')).statusCode).toBe(204);
    expect(await signIn(ctx, 'new@example.test')).toContain('session_token');
    // The permission was used up, and the code had one use.
    expect((await q(`SELECT 1 FROM signup_allowances`)).rows).toHaveLength(0);
    expect((await redeem(invite.code!, 'other@example.test')).statusCode).toBe(400);
    expect((await ctx.services.trust.listInvites())[0]).toMatchObject({ uses: 1, maxUses: 1 });
  });

  it('revoked and expired codes stop working; only admins make codes', async () => {
    const staff = await admin();
    await setSignup('invite');
    const revoked = await ctx.services.trust.createInvite(staff, {
      maxUses: 5,
      expiresInDays: null,
    });
    await ctx.services.trust.revokeInvite(staff, revoked.id);
    const expiring = await ctx.services.trust.createInvite(staff, {
      maxUses: 5,
      expiresInDays: 1,
    });
    ctx.clock.value += 2 * 86_400_000;
    for (const code of [revoked.code!, expiring.code!]) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/signup/redeem',
        payload: { code, email: 'late@example.test' },
      });
      expect(res.statusCode).toBe(400);
    }
    await expect(
      ctx.services.trust.createInvite(
        { ...staff, role: 'moderator' },
        { maxUses: 1, expiresInDays: 1 },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('verified members can invite up to three people when the admins allow it', async () => {
    const noa = await woman();
    await setSignup('invite', false);
    expect((await api(ctx, noa, 'POST', '/v1/me/invites')).statusCode).toBe(403);
    await setSignup('invite', true);
    expect((await api(ctx, noa, 'GET', '/v1/me/invites')).json().allowed).toBe(false); // unverified
    await q(`UPDATE profiles SET verified_at = now() WHERE user_id = $1`, [noa.id]);
    const codes = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await api(ctx, noa, 'POST', '/v1/me/invites');
      expect(res.statusCode).toBe(201);
      codes.push(res.json().code);
    }
    expect((await api(ctx, noa, 'POST', '/v1/me/invites')).statusCode).toBe(403);
    const listed = (await api(ctx, noa, 'GET', '/v1/me/invites')).json();
    expect(listed.invites).toHaveLength(3);
    // Listed later without the code itself (it's stored hashed).
    expect(listed.invites[0].code).toBeUndefined();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/signup/redeem',
      payload: { code: codes[0], email: 'friend@example.test' },
    });
    expect(res.statusCode).toBe(204);
  });

  // ------------------------------------------------------------------ waitlist

  it('waitlist mode: join, approval email, then the account opens', async () => {
    const staff = await admin();
    await setSignup('waitlist');
    const join = (email: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/signup/waitlist',
        payload: { email, note: 'A friend told me' },
      });
    expect((await join('wait@example.test')).statusCode).toBe(202);
    expect((await join('WAIT@example.test')).statusCode).toBe(202); // same person, no duplicate
    const pending = await ctx.services.trust.listWaitlist('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ email: 'wait@example.test', note: 'A friend told me' });

    // Not approved yet: no account.
    const before = ctx.mail.length;
    await requestLink('wait@example.test');
    await settle();
    expect(ctx.mail.slice(before)[0]!.text).toContain('waitlist');

    await ctx.services.trust.decideWaitlist({ ...staff, role: 'moderator' }, pending[0]!.id, true);
    await settle();
    expect(ctx.mail.at(-1)).toMatchObject({ to: 'wait@example.test' });
    expect(await signIn(ctx, 'wait@example.test')).toContain('session_token');
    // Deciding twice is refused; the address isn't in the audit log.
    await expect(
      ctx.services.trust.decideWaitlist(staff, pending[0]!.id, false),
    ).rejects.toMatchObject({ statusCode: 404 });
    const audits = await q(`SELECT meta::text FROM audit_logs WHERE action LIKE 'waitlist.%'`);
    expect(JSON.stringify(audits.rows)).not.toContain('wait@example.test');

    // Decided entries go after 90 days.
    await q(`UPDATE waitlist SET decided_at = now() - interval '91 days'`);
    expect((await processSignupRetention(ctx.services.dbHandle.db)).waitlist).toBe(1);
  });

  it('open mode is the default and the public info says so', async () => {
    const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
    expect(info.signup).toBe('open');
    expect(info.auth.passkey).toBe(true);
    // Redeeming or joining in open mode changes nothing (and reveals nothing).
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/signup/waitlist',
          payload: { email: 'x@example.test' },
        })
      ).statusCode,
    ).toBe(202);
    expect((await q(`SELECT 1 FROM waitlist`)).rows).toHaveLength(0);
  });

  // ------------------------------------------------------------------ passkeys

  it('offers passkey registration to signed-in members only', async () => {
    const noa = await woman();
    const options = await ctx.app.inject({
      method: 'GET',
      url: '/v1/auth/passkey/generate-register-options',
      headers: { cookie: noa.cookie, origin: 'http://localhost:8081' },
    });
    expect(options.statusCode).toBe(200);
    expect(options.json()).toMatchObject({ rp: { id: 'localhost' } });
    const anonymous = await ctx.app.inject({
      method: 'GET',
      url: '/v1/auth/passkey/generate-register-options',
      headers: { origin: 'http://localhost:8081' },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
