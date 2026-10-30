// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 64 end to end, in the dashboard: an admin shows and downloads a transparency report,
 * records a severe security incident and sees when the authority should be told, downloads the
 * Hebrew security statement, and filters the audit log to staff access to member data.
 * Usage: pnpm --dir e2e compliance (API and dashboard running)
 */
import { existsSync, readFileSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser, type Page } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import {
  apiClient,
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  signInHttp,
} from './lib.ts';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
type L = 'en' | 'he';
const STORY: Record<L, { names: [string, string]; title: string; description: string }> = {
  en: {
    names: ['Maya', 'Dan'],
    title: 'Backup bucket readable for two hours',
    description: 'A storage rule change made last night’s backup readable without a key.',
  },
  he: {
    names: ['מאיה', 'דן'],
    title: 'קובץ גיבוי היה פתוח לקריאה שעתיים',
    description: 'שינוי בהגדרות האחסון השאיר את הגיבוי של הלילה פתוח לקריאה בלי מפתח.',
  },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession(tag: string) {
  const email = `compliance-admin-${tag}-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

async function downloaded(page: Page, click: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: file.suggestedFilename(), text: readFileSync((await file.path())!, 'utf8') };
}

async function open(browser: Browser, locale: L, session: { name: string; value: string }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    locale: LOCALE_TAGS[locale],
    acceptDownloads: true,
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const a = adminMessages[locale];
    const c = a.compliance;
    const story = STORY[locale];

    // Incidents can't be deleted in the app: clear earlier runs' here, so this run's is the one shown.
    await pool.query('DELETE FROM security_incidents WHERE title = ANY($1)', [
      Object.values(STORY).map((s) => s.title),
    ]);
    // A notice and a decision, so the report has something in it.
    const maya = await onboardMember(`compliance-${locale}`, story.names[0], 'woman', ['man']);
    const dan = await onboardMember(`compliance-${locale}`, story.names[1], 'man', ['woman']);
    const { reportId } = await maya.call<{ reportId: string }>('POST', '/v1/reports', {
      targetId: dan.id,
      category: 'harassment',
      block: false,
    });
    const boss = await adminSession(locale);
    await boss.call('GET', `/v1/admin/reports/${reportId}`); // audited: staff.report_viewed
    await boss.call('POST', `/v1/admin/reports/${reportId}/resolve`, {
      action: 'warn',
      reason: 'Internal: first report.',
      ground: 'terms',
      explanation: 'Several messages to another member were insulting.',
    });

    const S = await open(browser, locale, boss.session);
    try {
      // ---------------------------------------------------------- transparency report
      await S.page.goto(`${ADMIN}/#/compliance`);
      await S.page.getByRole('heading', { level: 1, name: c.title }).waitFor();
      await S.page.getByRole('button', { name: c.show }).click();
      const decisions = S.page.getByRole('row', { name: c.decisions });
      await decisions.waitFor();
      const count = Number((await decisions.getByRole('cell').innerText()).trim());
      check(count >= 1, `the report counts this decision (${c.decisions}: ${count})`);
      const csv = await downloaded(S.page, () =>
        S.page.getByRole('button', { name: c.csv }).click(),
      );
      check(
        /^transparency-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name) &&
          csv.text.startsWith('section,item,value') &&
          csv.text.includes(`decisions,total,${count}`) &&
          !csv.text.includes(dan.id),
        `the CSV downloads, counts only (${csv.name})`,
      );

      // ---------------------------------------------------------- a severe incident
      const form = S.page.locator('form', {
        has: S.page.getByRole('heading', { name: c.newIncident }),
      });
      await form.getByLabel(c.incidentTitle).fill(story.title);
      await form.getByLabel(c.severity, { exact: true }).selectOption('severe');
      const hourAgo = new Date(Date.now() - 3_600_000 - new Date().getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
      await form.getByLabel(c.discovered).fill(hourAgo);
      await form.getByLabel(c.affected).fill('120');
      await form.getByLabel(c.description).fill(story.description);
      await form.getByRole('button', { name: c.record }).click();
      await S.page.getByText(c.recorded).waitFor();
      const item = S.page.locator('article', {
        has: S.page.getByRole('heading', { name: story.title }),
      });
      const mark = item.getByTestId('notify-by');
      await mark.waitFor();
      check(
        (await mark.innerText()).startsWith(c.notifyBy),
        'a severe incident shows when to notify the authority',
      );
      await item.scrollIntoViewIfNeeded();
      await audit(S.page, `${locale}/admin-compliance`);
      await shot(S.page, `${locale}/admin-35-compliance`);
      await item.getByRole('button', { name: new RegExp(c.markAuthority) }).click();
      await S.page.getByText(c.updated).waitFor();
      check(
        (await item.getByTestId('notify-by').count()) === 0,
        'once the authority is notified, the mark is gone',
      );

      // ---------------------------------------------------------- the Hebrew security statement
      const statement = await downloaded(S.page, () =>
        S.page
          .getByRole('listitem')
          .filter({ hasText: c.templates['security-statement'].title })
          .getByRole('button', { name: c.downloadHe })
          .click(),
      );
      check(
        statement.name === 'security-statement.he.md' &&
          statement.text.startsWith('# הצהרת אבטחה') &&
          statement.text.includes('טיוטה'),
        'the Hebrew security statement downloads, marked as a draft',
      );

      // ---------------------------------------------------------- staff access only
      await S.page.goto(`${ADMIN}/#/audit`);
      await S.page.getByLabel(a.audit.staffOnly).check();
      const first = S.page.locator('tbody tr').first().locator('code').first();
      await S.page.waitForFunction(() =>
        [...document.querySelectorAll('tbody tr td:nth-child(2) code')].every((el) =>
          el.textContent?.startsWith('staff.'),
        ),
      );
      const actions = await S.page.locator('tbody tr td:nth-child(2) code').allInnerTexts();
      check(
        actions.length > 0 &&
          actions.every((x) => x.startsWith('staff.') && x !== 'staff.mfa_failed') &&
          actions.includes('staff.report_viewed'),
        `the audit log shows staff access only (${actions.length} entries)`,
      );
      await first.waitFor();
      await audit(S.page, `${locale}/admin-staff-access`);
      await shot(S.page, `${locale}/admin-36-staff-access`);
    } finally {
      await S.context.close();
    }
  }
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nCompliance kit: OK\n');
