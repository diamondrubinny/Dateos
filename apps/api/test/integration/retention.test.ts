import { mediaKey } from '@nexaheart/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupModeration } from '../../../worker/src/profile-jobs.js';
import {
  cleanupPrivacy,
  handleInactiveAccounts,
  type InactivityContext,
} from '../../../worker/src/privacy-jobs.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('retention jobs (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let sent: { to: string; subject: string; text: string }[];
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const inactivity = (months: number): InactivityContext => ({
    db: ctx.services.dbHandle.db,
    storage: ctx.services.storage,
    months,
    instanceName: 'NexaHeart',
    sendMail: async (to, subject, text) => {
      sent.push({ to, subject, text });
    },
  });
  const email = async (m: Member) =>
    (await q('SELECT email FROM "user" WHERE id = $1', [m.id])).rows[0].email as string;

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    sent = [];
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  it('removes old audit entries and expired auth leftovers, keeps current ones', async () => {
    await q(
      `INSERT INTO audit_logs (action, created_at) VALUES ('old.one', now() - interval '731 days'), ('recent.one', now() - interval '700 days')`,
    );
    await q(
      `UPDATE session SET ip_address = '203.0.113.9', user_agent = 'Old browser' WHERE user_id = $1`,
      [noa.id],
    );
    await q(`UPDATE session SET expires_at = now() - interval '1 day' WHERE user_id = $1`, [
      dan.id,
    ]);
    await q(
      `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES ('v-old', 'x', 'y', now() - interval '1 hour', now(), now())`,
    );
    await q(
      `INSERT INTO rate_limit (id, key, count, last_request) VALUES ('r-old', 'k-old', 1, $1), ('r-new', 'k-new', 1, $2)`,
      [Date.now() - 2 * 86_400_000, Date.now()],
    );

    const result = await cleanupPrivacy(ctx.services.dbHandle.db);
    expect(result.auditLogs).toBe(1);
    expect(result.sessions).toBeGreaterThanOrEqual(1);

    const actions = (await q('SELECT action FROM audit_logs')).rows.map((r) => r.action);
    expect(actions).toContain('recent.one');
    expect(actions).not.toContain('old.one');
    expect((await q('SELECT 1 FROM session WHERE user_id = $1', [dan.id])).rowCount).toBe(0);
    expect(
      (await q('SELECT 1 FROM session WHERE user_id = $1', [noa.id])).rowCount,
    ).toBeGreaterThan(0);
    const leftovers = await q(
      'SELECT 1 FROM session WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL',
    );
    expect(leftovers.rowCount).toBe(0);
    expect((await q(`SELECT 1 FROM verification WHERE id = 'v-old'`)).rowCount).toBe(0);
    const limits = (await q('SELECT id FROM rate_limit')).rows.map((r) => r.id);
    expect(limits).toContain('r-new');
    expect(limits).not.toContain('r-old');
  });

  it('sessions do not store IP addresses or browser strings', async () => {
    const { rows } = await q('SELECT ip_address, user_agent FROM session');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.ip_address === null && r.user_agent === null)).toBe(true);
  });

  it('removes evidence files of deleted reports, but not ones that may still be committing', async () => {
    const { storage } = ctx.services;
    const key = 'evidence/00000000-0000-4000-8000-000000000000/voice.m4a';
    await storage.put(storage.buckets.media, key, Buffer.from('x'), 'audio/mp4');
    const exists = async () => (await storage.listKeys(storage.buckets.media, key)).length > 0;
    // A file written moments ago (its report transaction may be open) is kept.
    await cleanupModeration(ctx.services.dbHandle.db, storage);
    expect(await exists()).toBe(true);
    // Once past the grace period, a file without a report is deleted.
    await cleanupModeration(ctx.services.dbHandle.db, storage, -60_000);
    expect(await exists()).toBe(false);
  });

  it('does nothing when the inactivity rule is off (default)', async () => {
    await q(`UPDATE "user" SET last_seen_at = now() - interval '10 years'`);
    expect(await handleInactiveAccounts(inactivity(0))).toEqual({
      warned: 0,
      deleted: 0,
      returned: 0,
    });
    expect(sent).toHaveLength(0);
  });

  it('warns first, deletes only after the notice period, and never touches staff', async () => {
    await q(`UPDATE "user" SET last_seen_at = now() - interval '25 months' WHERE id IN ($1, $2)`, [
      noa.id,
      dan.id,
    ]);
    await q(`UPDATE "user" SET role = 'moderator' WHERE id = $1`, [dan.id]);

    const first = await handleInactiveAccounts(inactivity(24));
    expect(first).toMatchObject({ warned: 1, deleted: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(await email(noa));
    expect(sent[0]!.text).toContain('sign in before');
    expect(sent[0]!.text).not.toMatch(/https?:\/\//); // no links in an unexpected email (phishing hygiene)

    // A second run within the notice period neither re-sends nor deletes.
    expect(await handleInactiveAccounts(inactivity(24))).toMatchObject({ warned: 0, deleted: 0 });
    expect(sent).toHaveLength(1);

    // 31 days later, still no sign-in: the account and its files are deleted.
    const photoKey = mediaKey(noa.id, noa.photoId);
    expect(
      (await ctx.services.storage.listKeys(ctx.services.storage.buckets.media, photoKey)).length >
        0,
    ).toBe(true);
    await q(`UPDATE "user" SET inactivity_notice_at = now() - interval '31 days' WHERE id = $1`, [
      noa.id,
    ]);
    expect(await handleInactiveAccounts(inactivity(24))).toMatchObject({ deleted: 1 });
    expect((await q('SELECT 1 FROM "user" WHERE id = $1', [noa.id])).rowCount).toBe(0);
    expect(
      (await ctx.services.storage.listKeys(ctx.services.storage.buckets.media, photoKey)).length >
        0,
    ).toBe(false);
    expect(
      (
        await q(
          `SELECT 1 FROM audit_logs WHERE action = 'account.deleted_inactive' AND target_id = $1`,
          [noa.id],
        )
      ).rowCount,
    ).toBe(1);
    // Staff are never included.
    expect((await q('SELECT 1 FROM "user" WHERE id = $1', [dan.id])).rowCount).toBe(1);
  });

  it('a sign-in after the warning keeps the account', async () => {
    await q(`UPDATE "user" SET last_seen_at = now() - interval '25 months' WHERE id = $1`, [
      noa.id,
    ]);
    await handleInactiveAccounts(inactivity(24));
    expect(sent).toHaveLength(1);

    await signIn(ctx, await email(noa));
    const row = (
      await q('SELECT inactivity_notice_at, last_seen_at FROM "user" WHERE id = $1', [noa.id])
    ).rows[0];
    expect(row.inactivity_notice_at).toBeNull();
    expect(Date.now() - new Date(row.last_seen_at).getTime()).toBeLessThan(60_000);

    await q(
      `UPDATE "user" SET inactivity_notice_at = now() - interval '31 days' WHERE id = $1 AND inactivity_notice_at IS NOT NULL`,
      [noa.id],
    );
    expect(await handleInactiveAccounts(inactivity(24))).toMatchObject({ deleted: 0 });
    expect((await api(ctx, noa, 'GET', '/v1/me')).statusCode).toBe(200);
  });
});
