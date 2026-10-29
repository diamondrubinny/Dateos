// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processBackupWatch } from '../../../worker/src/backup-watch.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('email admins when backups stop (integration)', () => {
  let ctx: TestContext;
  let sent: { to: string; subject: string; text: string; html: string }[];
  let alerts: string[];
  let failFor: string | null;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const run = (now = new Date()) =>
    processBackupWatch({
      db: ctx.services.dbHandle.db,
      instanceName: async () => 'Ahava',
      adminUrl: 'https://admin.example.org/',
      sendMail: async (m) => {
        if (m.to === failFor) throw new Error('mailbox unavailable');
        sent.push(m);
      },
      alert: async (text) => void alerts.push(text),
      now: () => now,
    });
  /** A staff or member account, created `daysAgo` days ago. */
  async function account(email: string, role: string, daysAgo = 5, status = 'active') {
    await signIn(ctx, email);
    await q(
      `UPDATE "user" SET role = $2, status = $3, created_at = now() - make_interval(days => $4)
       WHERE email = $1`,
      [email, role, status, daysAgo],
    );
  }
  const backupAt = (hoursAgo: number) =>
    q(
      `INSERT INTO maintenance_runs (kind, bytes, finished_at)
       VALUES ('backup', 1024, now() - make_interval(hours => $1))`,
      [hoursAgo],
    );

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    await q('DELETE FROM maintenance_runs');
    sent = [];
    alerts = [];
    failFor = null;
    await account('admin-one@example.test', 'admin');
    await account('admin-two@example.test', 'admin');
    await account('mod@example.test', 'moderator');
    await account('old-admin@example.test', 'admin', 5, 'suspended');
  });

  it('a recent backup: nothing is sent', async () => {
    await backupAt(5);
    expect(await run()).toEqual({ state: 'fresh' });
    expect(sent).toHaveLength(0);
  });

  it('a new server gets two days for its first backup', async () => {
    await q(`UPDATE "user" SET created_at = now() - interval '10 hours'`);
    expect(await run()).toEqual({ state: 'new-server' });
    expect(sent).toHaveLength(0);
  });

  it('no backup ever: every active admin is emailed, and the alert channel told', async () => {
    expect(await run()).toEqual({ state: 'alerted', emailed: 2 });
    expect(sent.map((m) => m.to).sort()).toEqual([
      'admin-one@example.test',
      'admin-two@example.test',
    ]);
    const mail = sent[0]!;
    expect(mail.subject).toContain('Ahava');
    expect(mail.text).toContain('No backup of Ahava has been recorded.');
    expect(mail.text).toContain('https://admin.example.org/#/system');
    expect(mail.html).toContain('dir="rtl"');
    expect(alerts).toEqual([
      '⚠️ Ahava: no backup recorded recently. https://admin.example.org/#/system',
    ]);
  });

  it('an old backup is named in the email, and the alert repeats once a day, not every run', async () => {
    await backupAt(40);
    const first = new Date();
    expect((await run(first)).state).toBe('alerted');
    expect(sent[0]!.text).toMatch(/The last backup of Ahava finished on .+ UTC\./);
    expect(await run(new Date(first.getTime() + 2 * 3_600_000))).toEqual({ state: 'already-told' });
    expect(sent).toHaveLength(2);
    expect((await run(new Date(first.getTime() + 21 * 3_600_000))).state).toBe('alerted');
    expect(sent).toHaveLength(4);
  });

  it('one address failing still reaches the others; a new backup stops the emails', async () => {
    failFor = 'admin-one@example.test';
    expect(await run()).toEqual({ state: 'alerted', emailed: 1 });
    await backupAt(1);
    expect(await run(new Date(Date.now() + 25 * 3_600_000))).toEqual({ state: 'fresh' });
  });
});
