// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processUpdateNotice, processUpdateResults } from '../../../worker/src/update-mail.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

describe.skipIf(!integrationEnabled)('update emails to the admins (integration)', () => {
  let ctx: TestContext;
  let sent: { to: string; subject: string; text: string; html: string }[];
  let failFor: string | null;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const base = () => ({
    db: ctx.services.dbHandle.db,
    instanceName: async () => 'Ahava',
    adminUrl: 'https://admin.example.org/',
    sendMail: async (m: { to: string; subject: string; text: string; html: string }) => {
      if (m.to === failFor) throw new Error('mailbox unavailable');
      sent.push(m);
    },
  });
  const notice = (now = new Date(), current: string | null = A) =>
    processUpdateNotice({
      ...base(),
      repo: 'diamondrubinny/NexaHeart',
      current: current ?? undefined,
      now: () => now,
    });
  /** The last check: this server runs A, the branch is at `latest`. */
  const checked = (latest: string, behind: number, current = A) =>
    q(
      `INSERT INTO update_status (id, checked_at, current_commit, latest_commit, behind, changes)
       VALUES (1, now(), $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET current_commit = $1, latest_commit = $2, behind = $3,
         changes = $4`,
      [
        current,
        latest,
        behind,
        JSON.stringify([
          {
            title: 'Phase 54: update emails to the admins',
            number: 63,
            at: '2026-10-30T08:00:00Z',
          },
        ]),
      ],
    );
  const request = (status: string, message: string | null = null, target = B) =>
    q(
      `INSERT INTO update_requests (target_commit, from_commit, status, finished_at, message)
       VALUES ($1, $2, $3::varchar,
         CASE WHEN $3::varchar IN ('done', 'failed', 'cancelled') THEN now() END, $4)`,
      [target, A, status, message],
    );

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    await q('DELETE FROM update_requests');
    await q('DELETE FROM update_status');
    sent = [];
    failFor = null;
    for (const email of ['admin-one@example.test', 'admin-two@example.test']) {
      await signIn(ctx, email);
      await q(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
    }
    await signIn(ctx, 'mod@example.test');
    await q(`UPDATE "user" SET role = 'moderator' WHERE email = 'mod@example.test'`);
  });

  it('a new version: every active admin is emailed what was added or fixed, once', async () => {
    await checked(B, 3);
    expect(await notice()).toEqual({ state: 'notified', emailed: 2 });
    expect(sent.map((m) => m.to).sort()).toEqual([
      'admin-one@example.test',
      'admin-two@example.test',
    ]);
    expect(sent[0]!.subject).toBe('Ahava: יש עדכון · Update available');
    expect(sent[0]!.text).toContain('Phase 54: update emails to the admins (#63)');
    expect(sent[0]!.text).toContain('https://admin.example.org/#/system');
    expect(await notice(new Date(Date.now() + 30 * 3_600_000))).toEqual({ state: 'already-told' });
    expect(sent).toHaveLength(2);
  });

  it('a newer version is announced, but not more than once in 20 hours', async () => {
    await checked(B, 3);
    const first = new Date();
    await notice(first);
    await checked(C, 5);
    expect(await notice(new Date(first.getTime() + 6 * 3_600_000))).toEqual({
      state: 'already-told',
    });
    expect(await notice(new Date(first.getTime() + 21 * 3_600_000))).toEqual({
      state: 'notified',
      emailed: 2,
    });
    expect(sent).toHaveLength(4);
  });

  it('up to date, an unknown or another version: nothing is sent', async () => {
    expect(await notice()).toEqual({ state: 'up-to-date' });
    await checked(A, 0);
    expect(await notice()).toEqual({ state: 'up-to-date' });
    await checked(B, 3);
    expect(await notice(new Date(), null)).toEqual({ state: 'up-to-date' });
    expect(await notice(new Date(), C)).toEqual({ state: 'up-to-date' });
    expect(sent).toHaveLength(0);
  });

  it('nothing while an update is already approved or running', async () => {
    await checked(B, 3);
    await request('pending');
    expect(await notice()).toEqual({ state: 'approved' });
    await q(`UPDATE update_requests SET status = 'running', started_at = now()`);
    expect(await notice()).toEqual({ state: 'approved' });
    expect(sent).toHaveLength(0);
  });

  it('one address failing still reaches the others, and is not retried every run', async () => {
    await checked(B, 3);
    failFor = 'admin-one@example.test';
    expect(await notice()).toEqual({ state: 'notified', emailed: 1 });
    failFor = null;
    expect(await notice(new Date(Date.now() + 25 * 3_600_000))).toEqual({ state: 'already-told' });
  });

  it('results: installed and failed are emailed once each; a withdrawn one is not', async () => {
    await request('done', 'Installed bbbbbbb (was aaaaaaa).');
    await request('failed', 'The new version didn’t start, so the server went back to aaaaaaa.', C);
    await request('cancelled', null, C);
    expect(await processUpdateResults(base())).toEqual({ results: 2, emailed: 4 });
    const subjects = sent.map((m) => m.subject).sort();
    expect(subjects).toEqual([
      'Ahava: העדכון הותקן · Update installed',
      'Ahava: העדכון הותקן · Update installed',
      '⚠️ Ahava: העדכון לא הותקן · Update not installed',
      '⚠️ Ahava: העדכון לא הותקן · Update not installed',
    ]);
    expect(sent.some((m) => m.text.includes('Installed bbbbbbb (was aaaaaaa).'))).toBe(true);
    expect(await processUpdateResults(base())).toEqual({ results: 0, emailed: 0 });
  });

  it('a request still waiting or running is not a result', async () => {
    await request('running');
    expect(await processUpdateResults(base())).toEqual({ results: 0, emailed: 0 });
    expect(sent).toHaveLength(0);
  });
});
