// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 53 end to end: an admin sees that an update is available (on every page), reads what's new
 * on System, approves it, sees it waiting for the server, withdraws it, and sees a failed one
 * explained. The API must run with APP_COMMIT=1111…1111 (see RUNNING below); the GitHub answer is
 * seeded in the database, as the worker would save it.
 * Usage: pnpm --dir e2e admin-updates
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import {
  audit,
  locales,
  magicLink,
  reportA11y,
  resetSignInLimits,
  shot,
  signInHttp,
} from './lib.ts';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const RUNNING = '1'.repeat(40);
const LATEST = '3'.repeat(40);

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function seed() {
  await pool.query('DELETE FROM update_requests');
  await pool.query('DELETE FROM update_status');
  await pool.query(
    `INSERT INTO update_status (id, checked_at, current_commit, latest_commit, latest_at, behind, changes)
     VALUES (1, now(), $1, $2, now(), 3, $3)`,
    [
      RUNNING,
      LATEST,
      JSON.stringify([
        {
          title: 'Phase 53: updates from GitHub, approved in the dashboard',
          number: 62,
          at: new Date().toISOString(),
        },
        {
          title: 'Phase 52: email the admins when backups stop',
          number: 61,
          at: new Date(Date.now() - 86_400_000).toISOString(),
        },
      ]),
    ],
  );
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const a = adminMessages[locale];
    const u = a.updates;
    await seed();
    const email = `admin-updates-${locale}-${Date.now()}@example.test`;
    await signInHttp(email);
    await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
    await pool.query('DELETE FROM rate_limit');

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: locale === 'he' ? 'he-IL' : 'en-US',
    });
    await context.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${ADMIN}/`);
      await page.getByLabel(a.signIn.email).fill(email);
      await page.getByRole('button', { name: a.signIn.submit }).click();
      await page.getByText(a.signIn.sent).waitFor();
      await page.goto(await magicLink(email));
      await page.getByRole('button', { name: a.mfa.start }).click();
      const secret = (await page.locator('code.secret').innerText()).replace(/\s/g, '');
      await page.getByLabel(a.mfa.code).fill(totp(secret, Date.now()));
      await page.getByRole('button', { name: a.mfa.submit }).click();
      await page.getByRole('heading', { name: a.reports.title }).waitFor();

      // 1. Every page says so.
      const banner = page.getByTestId('update-banner');
      await banner.waitFor();
      check((await banner.innerText()).includes(u.banner(3)), 'the banner on the reports page');
      await banner.getByRole('link', { name: u.bannerLink }).click();

      // 2. What's new.
      const changes = page.getByTestId('update-changes');
      await changes.waitFor();
      const text = await changes.innerText();
      check(
        text.includes('Phase 53: updates from GitHub') && text.includes('#61'),
        'what was added or fixed, with links to the changes',
      );
      check(
        (await page.getByRole('heading', { name: u.available(3) }).count()) === 1,
        'how many changes',
      );
      check(
        (await page.getByTestId('updates').innerText()).includes(u.emailsOn),
        'says the admins are emailed about updates',
      );
      await audit(page, `${locale}/admin-updates`);
      await page.getByTestId('updates').scrollIntoViewIfNeeded();
      await shot(page, `${locale}/127-admin-update-available`);

      // 3. Approve: the steps are explained first.
      await page.getByRole('button', { name: u.install }).click();
      for (const step of u.confirmSteps) await page.getByText(step).waitFor();
      await audit(page, `${locale}/admin-update-confirm`);
      await page.getByRole('button', { name: u.approve }).click();
      const req = page.getByTestId('update-request');
      await req.getByText(u.pending).waitFor();
      const { rows } = await pool.query(
        `SELECT status, target_commit, from_commit FROM update_requests ORDER BY requested_at DESC LIMIT 1`,
      );
      check(
        rows[0]?.status === 'pending' &&
          rows[0]?.target_commit === LATEST &&
          rows[0]?.from_commit === RUNNING,
        'the approval is recorded for exactly the latest version',
      );
      await shot(page, `${locale}/128-admin-update-approved`);

      // 4. Withdraw it before the server starts.
      await req.getByRole('button', { name: u.cancel }).click();
      await page.getByRole('button', { name: u.install }).waitFor();
      check(
        (await pool.query(`SELECT status FROM update_requests`)).rows[0]?.status === 'cancelled',
        'a waiting approval can be withdrawn',
      );

      // 4b. Phase 56: install at a chosen time (e.g. at night), not now.
      await page.getByRole('button', { name: u.install }).click();
      await page.getByRole('radio', { name: u.whenLater }).check();
      const atField = page.getByLabel(u.at);
      check(
        /T03:00$/.test(await atField.inputValue()),
        'the time starts at the coming 03:00, in the admin’s time zone',
      );
      // A time that has passed is refused in place, tied to the field.
      // Written as a string: the test runner's helpers don't exist in the page.
      const local = (offsetMs: number) =>
        page.evaluate<string>(`(() => {
          const d = new Date(Date.now() + ${offsetMs});
          const p = (n) => String(n).padStart(2, '0');
          return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' +
            p(d.getHours()) + ':' + p(d.getMinutes());
        })()`);
      await atField.fill(await local(-3_600_000));
      await page.getByRole('button', { name: u.approveAt }).click();
      await page.getByText(u.atInvalid(7)).waitFor();
      check(
        (await atField.getAttribute('aria-invalid')) === 'true' &&
          ((await atField.getAttribute('aria-describedby')) ?? '').includes('update-at-error'),
        'a past time is refused in place, tied to the field',
      );
      const chosen = await local(5 * 3_600_000);
      await atField.fill(chosen);
      await audit(page, `${locale}/admin-update-schedule`);
      await page.getByTestId('updates').scrollIntoViewIfNeeded();
      await shot(page, `${locale}/134-admin-update-schedule`);
      await page.getByRole('button', { name: u.approveAt }).click();
      const scheduled = page.getByTestId('update-request');
      await scheduled.getByText(u.scheduled('').split(' ')[0]!, { exact: false }).waitFor();
      const sched = await pool.query(
        `SELECT status, not_before FROM update_requests WHERE status = 'pending'`,
      );
      const notBefore = sched.rows[0]?.not_before as Date | undefined;
      check(
        Boolean(notBefore) &&
          Math.abs(notBefore!.getTime() - (Date.now() + 5 * 3_600_000)) < 120_000,
        'the approval is recorded for the chosen time',
      );
      check(
        (await scheduled.innerText()).includes(u.cancel),
        'until then it says when, and can be withdrawn',
      );
      await shot(page, `${locale}/135-admin-update-scheduled`);
      await scheduled.getByRole('button', { name: u.cancel }).click();
      await page.getByRole('button', { name: u.install }).waitFor();

      // 5. A failed update is explained, as an alert.
      await pool.query(
        `INSERT INTO update_requests (target_commit, from_commit, status, finished_at, message)
         VALUES ($1, $2, 'failed', now(), $3)`,
        [LATEST, RUNNING, "The new version didn't start, so the server went back to 1111111."],
      );
      await page.reload();
      await page.getByTestId('update-request').getByText(u.failedInstall).waitFor();
      check(
        (await page.getByTestId('update-request').getAttribute('role')) === 'alert',
        'a failed update is an alert, with what happened',
      );
      check(
        (await page.getByTestId('update-banner').innerText()).includes(u.bannerFailed),
        'the banner says the last update failed',
      );
      await audit(page, `${locale}/admin-update-failed`);

      // 6. Phase 56: the history of finished approvals (the two withdrawn above), in words.
      const history = page.getByTestId('update-history');
      await history.waitFor();
      check(
        (await history.locator('caption').innerText()) === u.history.title &&
          (await history.getByRole('columnheader').count()) === 3,
        'the history is a table with a caption and column headers',
      );
      check(
        (await history.getByRole('row').count()) === 3 &&
          (await history.getByText(u.history.cancelled).count()) === 2,
        'it lists the withdrawn approvals, in words',
      );
      await history.scrollIntoViewIfNeeded();
      await shot(page, `${locale}/136-admin-update-history`);
    } finally {
      await context.close();
    }
  }
} finally {
  await pool.query('DELETE FROM update_requests');
  await pool.query('DELETE FROM update_status');
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nDashboard updates: OK\n');
