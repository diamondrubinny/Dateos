// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 49 accessibility sweep of the moderation dashboard: every page an admin can open, plus a
 * report with content, in dark and light mode and in English and Hebrew. axe-core on each, and
 * the focus ring and form-field edges checked from computed styles.
 * Usage: pnpm --dir e2e admin-a11y
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import {
  audit,
  locales,
  magicLink,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  signInHttp,
} from './lib.ts';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const PAGES = [
  'reports',
  'overview',
  'verifications',
  'venues',
  'events',
  'signup',
  'partners',
  'audit',
  'branding',
  'integrations',
  'system',
] as const;

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function open(browser: Browser, locale: 'en' | 'he', colorScheme: 'light' | 'dark') {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 1,
    locale: locale === 'he' ? 'he-IL' : 'en-US',
    colorScheme,
  });
  await context.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

/** WCAG contrast of two computed rgb() colours. */
const contrastScript = (a: string, b: string) => {
  const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const lum = (c: string) => {
    const [r, g, bl] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const a = adminMessages[locale];
    // Content: a report with details.
    const reporter = await onboardMember(`adm-a11y-${locale}`, 'Maya', 'woman', ['man']);
    const reported = await onboardMember(`adm-a11y-${locale}`, 'Dan', 'man', ['woman']);
    await reporter.call('POST', '/v1/reports', {
      targetId: reported.id,
      category: 'harassment',
      details: locale === 'he' ? 'הודעות פוגעניות שוב ושוב.' : 'Hurtful messages again and again.',
    });

    const email = `admin-a11y-${locale}-${Date.now()}@example.test`;
    await signInHttp(email);
    await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
    await pool.query('DELETE FROM rate_limit');
    const S = await open(browser, locale, 'dark');
    try {
      await S.page.goto(`${ADMIN}/`);
      await S.page.getByLabel(a.signIn.email).fill(email);
      await S.page.getByRole('button', { name: a.signIn.submit }).click();
      await S.page.getByText(a.signIn.sent).waitFor();
      await S.page.goto(await magicLink(email));
      await S.page.getByRole('button', { name: a.mfa.start }).click();
      const secret = (await S.page.locator('code.secret').innerText()).replace(/\s/g, '');
      await S.page.getByLabel(a.mfa.code).fill(totp(secret, Date.now()));
      await S.page.getByRole('button', { name: a.mfa.submit }).click();
      await S.page.getByRole('heading', { name: a.reports.title }).waitFor();

      // One sign-in, both modes: the page follows the emulated system setting.
      for (const scheme of ['dark', 'light'] as const) {
        await S.page.emulateMedia({ colorScheme: scheme });
        for (const key of PAGES) {
          await S.page.goto(`${ADMIN}/#/${key}`);
          await S.page.waitForLoadState('networkidle');
          await S.page.waitForTimeout(300);
          await audit(S.page, `${locale}/admin-${scheme}/${key}`);
        }
        // A report's detail page.
        await S.page.goto(`${ADMIN}/#/reports`);
        await S.page.waitForLoadState('networkidle');
        await S.page.locator('main a[href^="#/reports/"]').first().click();
        await S.page.waitForLoadState('networkidle');
        await audit(S.page, `${locale}/admin-${scheme}/report`);
        check(true, `${scheme}: ${PAGES.length + 1} dashboard pages audited`);

        // Form fields: the edge that identifies them is at least 3:1 against what's around them.
        await S.page.goto(`${ADMIN}/#/venues`);
        await S.page.waitForLoadState('networkidle');
        const edges = await S.page.evaluate(() => {
          const field = document.querySelector('main input[type="text"], main input:not([type])');
          if (!field) return null;
          const card = field.closest('section, form, main') as HTMLElement;
          return {
            border: getComputedStyle(field).borderTopColor,
            around: getComputedStyle(card).backgroundColor,
            page: getComputedStyle(document.body).backgroundColor,
          };
        });
        const ratio =
          edges &&
          contrastScript(
            edges.border,
            edges.around.includes('0, 0, 0, 0') ? edges.page : edges.around,
          );
        check(Boolean(ratio && ratio >= 3), `${scheme}: field edges ${ratio?.toFixed(2)}:1 (≥ 3)`);
        if (scheme === 'dark') await shot(S.page, `${locale}/125-admin-dark`);

        // System (phase 51): no recent backup is a visible warning; a recent one isn't.
        await pool.query(`DELETE FROM maintenance_runs WHERE kind = 'backup'`);
        await S.page.goto(`${ADMIN}/#/system`);
        const backup = S.page.getByTestId('system-backup');
        await backup.getByText(a.system.backupNever).waitFor();
        check((await backup.getAttribute('role')) === 'alert', `${scheme}: no backup is an alert`);
        if (scheme === 'dark') await shot(S.page, `${locale}/126-admin-system-no-backup`);
        await pool.query(`INSERT INTO maintenance_runs (kind, bytes) VALUES ('backup', 734003200)`);
        await S.page.getByRole('button', { name: a.system.refresh }).click();
        await backup.getByText(a.system.backupOk).waitFor();
        check(true, `${scheme}: a recent backup shows as fine`);
        await audit(S.page, `${locale}/admin-${scheme}/system-ok`);
      }
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
process.stdout.write('\nDashboard accessibility sweep: OK\n');
