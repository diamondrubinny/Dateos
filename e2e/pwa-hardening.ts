// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 72 end to end: "I'm OK" from a check-in notification opens /checkin?ok=1, which confirms
 * the active check-in once; Settings has "Show a number on the app icon", replaced by a note when
 * notifications are discreet; the app sets the number on its icon from unread chats.
 * Usage: pnpm --dir e2e pwa-hardening
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  WEB,
  type OnboardedMember,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = {
  en: ['Maya', 'Dan'],
  he: ['מאיה', 'דן'],
  ar: ['ليلى', 'سامي'],
  ru: ['Маша', 'Дима'],
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

async function open(browser: Browser, locale: L, member: OnboardedMember) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  const { name, value } = member.session;
  await context.addCookies([
    { name, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  // Records what the app asks for the number on its icon. Chromium has the API natively, so it's
  // replaced on the prototype; a string, so the test runner adds nothing the page doesn't have.
  await context.addInitScript(`
    const record = (n) => { window.__badge = n; return Promise.resolve(); };
    Object.defineProperty(Navigator.prototype, 'setAppBadge', {
      configurable: true, value: (n) => record(n === undefined ? 1 : n) });
    Object.defineProperty(Navigator.prototype, 'clearAppBadge', {
      configurable: true, value: () => record(0) });
  `);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [her, him] = NAMES[locale];
    const maya = await onboardMember(`pwa72-${locale}`, her, 'woman', ['man']);
    const dan = await onboardMember(`pwa72-${locale}`, him, 'man', ['woman']);
    const now = Date.now();
    await maya.call('POST', '/v1/me/checkins', {
      place: 'Café Puaa, Jaffa',
      startsAt: new Date(now).toISOString(),
      checkAt: new Date(now + 2 * 3_600_000).toISOString(),
      contactName: 'Dana',
      contactEmail: `dana-${locale}-${now}@example.test`,
      locale,
      timeZone: 'Asia/Jerusalem',
    });
    // A chat with an unread message, for the number on the icon.
    await dan.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
    const { matchId } = await maya.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    await dan.call('POST', `/v1/matches/${matchId}/messages`, {
      clientId: `msg-pwa72-${locale}-xxxx`,
      text: 'Hi!',
    });

    const A = await open(browser, locale, maya);
    try {
      // 1. "I'm OK" from the notification: the check-in is confirmed once.
      await A.page.goto(`${WEB}/checkin?ok=1`);
      await A.page.getByText(t.checkin.okDone).first().waitFor();
      const { rows } = await pool.query(
        `SELECT status FROM checkins WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [maya.id],
      );
      check(rows[0]?.status !== 'active', '“I’m OK” from the notification confirmed the check-in');

      // 2. The number on the icon: one chat with an unread message.
      await A.page.goto(`${WEB}/matches`);
      await A.page.waitForFunction(() => (window as unknown as { __badge?: number }).__badge === 1);
      check(true, 'the app icon shows 1 (one chat with unread messages)');

      // 3. The setting, and the note when notifications are discreet.
      await A.page.goto(`${WEB}/settings`);
      const box = A.page.getByRole('checkbox', { name: t.appBadge.label });
      await box.waitFor();
      check((await box.getAttribute('aria-checked')) === 'true', 'on by default');
      await audit(A.page, `${locale}/app-badge-setting`);
      await box.scrollIntoViewIfNeeded();
      await shot(A.page, `${locale}/187-app-badge`);
      await box.click();
      await A.page.waitForFunction(() => (window as unknown as { __badge?: number }).__badge === 0);
      check(true, 'turned off: the number is cleared');
      await maya.call('PUT', '/v1/me/settings', { appBadge: true, discreetNotifications: true });
      await A.page.reload();
      await A.page.getByTestId('app-badge-discreet').waitFor();
      check(true, 'discreet notifications: a note instead of the setting');
    } finally {
      await A.context.close();
    }
  }
  // 4. The service worker shows a push sent only in the declarative form, with its button and
  // without a name (delivered through the browser's own test hook).
  process.stdout.write('service worker:\n');
  const context = await browser.newContext();
  await context.grantPermissions(['notifications'], { origin: WEB });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const registrations: { registrationId: string; scopeURL: string }[] = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registrations.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await page.goto(WEB);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForTimeout(1000);
  const registration = registrations.find((r) => r.scopeURL.startsWith(WEB));
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: WEB,
    registrationId: registration!.registrationId,
    data: JSON.stringify({
      web_push: 8030,
      notification: {
        title: 'Ahava',
        body: 'Time to check in: let us know you are OK',
        navigate: `${WEB}/checkin`,
        lang: 'en',
      },
      kind: 'checkin',
      id: 'x',
      actions: [{ action: 'ok', title: "I'm OK" }],
    }),
  });
  await page.waitForTimeout(1500);
  const shown = await page.evaluate(async () =>
    (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
      title: n.title,
      body: n.body,
      actions: (
        (n as unknown as { actions: { action: string; title: string }[] }).actions ?? []
      ).map((a) => `${a.action}:${a.title}`),
    })),
  );
  check(
    shown.length === 1 &&
      shown[0]!.title === 'Ahava' &&
      shown[0]!.body.startsWith('Time to check in') &&
      shown[0]!.actions.join() === "ok:I'm OK",
    'the service worker shows the declarative form, with “I’m OK”',
  );
  await context.close();
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nPWA hardening: OK\n');
