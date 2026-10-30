// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 60 end to end, on the built web app (pnpm build:web) with the API's WEB_PUSH_PUBLIC_KEY set:
 * a member turns notifications on (the browser asks; permission granted), the subscription reaches
 * the server; a push delivered to the service worker (Chrome DevTools, as a push service would)
 * shows the community's notification with no names, set to open the chat; turning it off and
 * signing out remove it.
 * Only the browser's subscribe call is replaced: a real one needs Google's push servers, which a
 * test machine can't reach. It returns a well-formed subscription at fcm.googleapis.com.
 * Usage: pnpm --dir e2e web-push
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { pushContent } from '../apps/worker/src/push.ts';
import {
  API,
  apiClient,
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  WEB,
} from './lib.ts';

const T = { en, he } as const;
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

const config = (await (await fetch(`${API}/v1/push/web`)).json()) as { enabled: boolean };
if (!config.enabled) {
  process.stderr.write('Start the API with WEB_PUSH_PUBLIC_KEY (scripts/web-push-keys.sh).\n');
  process.exit(1);
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const noa = await onboardMember(`webpush-noa-${locale}`, 'Noa', 'woman', ['man']);
    const dan = await onboardMember(`webpush-dan-${locale}`, 'Dan', 'man', ['woman']);
    await apiClient(dan.session.header)('POST', '/v1/interactions', {
      targetId: noa.id,
      kind: 'like',
    });
    const { matchId } = await apiClient(noa.session.header)<{ matchId: string }>(
      'POST',
      '/v1/interactions',
      { targetId: dan.id, kind: 'like' },
    );
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: LOCALE_TAGS[locale],
    });
    await context.grantPermissions(['notifications'], { origin: WEB });
    await context.addCookies([
      {
        name: noa.session.name,
        value: noa.session.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
    // The browser's subscribe call only (see the header): a well-formed subscription. Written as a
    // string: the test runner's helpers don't exist in the page.
    await context.addInitScript(`(() => {
      let current = null;
      const b64 = (bytes) =>
        btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
          .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      const fake = () => {
        const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-${locale}-' + Date.now();
        const keys = { p256dh: ('B' + b64(64)).slice(0, 87), auth: b64(16) };
        return {
          endpoint,
          expirationTime: null,
          toJSON: () => ({ endpoint, expirationTime: null, keys }),
          unsubscribe: async () => { current = null; return true; },
        };
      };
      PushManager.prototype.subscribe = async function () { current = fake(); return current; };
      PushManager.prototype.getSubscription = async function () { return current; };
    })()`);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    const rows = async () =>
      (
        await pool.query<{ endpoint: string; locale: string }>(
          'SELECT endpoint, locale FROM web_push_subscriptions WHERE user_id = $1',
          [noa.id],
        )
      ).rows;
    try {
      await page.goto(`${WEB}/settings`);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      check(
        (await page.getByText(t.push.unsupported).count()) === 0,
        'the web app no longer says notifications are only in the phone app',
      );
      const box = page.getByRole('checkbox', { name: t.push.label });
      await box.scrollIntoViewIfNeeded();
      await box.click();
      await page.waitForFunction(
        (label) =>
          document
            .querySelector(`[role="checkbox"][aria-label="${label}"]`)
            ?.getAttribute('aria-checked') === 'true',
        t.push.label,
        { timeout: 15_000 },
      );
      const saved = await rows();
      check(
        saved.length === 1 &&
          saved[0]!.endpoint.startsWith('https://fcm.googleapis.com/') &&
          saved[0]!.locale === locale,
        'turning it on sends this browser’s subscription to the community’s server',
      );
      await audit(page, `${locale}/web-push-settings`);
      await shot(page, `${locale}/138-web-push-on`);

      // A push, as the push service delivers it: the worker's own content for a message.
      const payload = {
        ...pushContent('message', locale, 'NexaHeart'),
        kind: 'message',
        id: matchId,
      };
      const cdp = await context.newCDPSession(page);
      const registrations: { registrationId: string; scopeURL: string }[] = [];
      cdp.on('ServiceWorker.workerRegistrationUpdated', (e) =>
        registrations.push(...(e.registrations as typeof registrations)),
      );
      await cdp.send('ServiceWorker.enable');
      for (let i = 0; i < 20 && registrations.length === 0; i += 1) await page.waitForTimeout(250);
      const reg = registrations.find((r) => r.scopeURL.startsWith(WEB));
      check(Boolean(reg), 'the app’s service worker is registered');
      await cdp.send('ServiceWorker.deliverPushMessage', {
        origin: new URL(WEB).origin,
        registrationId: reg!.registrationId,
        data: JSON.stringify(payload),
      });
      // What the service worker showed (asked until it's there).
      let notes: { title: string; body: string; data: { url: string } }[] = [];
      for (let i = 0; i < 40 && notes.length === 0; i += 1) {
        notes = await page.evaluate<typeof notes>(
          `navigator.serviceWorker.ready
            .then((r) => r.getNotifications())
            .then((list) => list.map((n) => ({ title: n.title, body: n.body, data: n.data })))`,
        );
        if (notes.length === 0) await page.waitForTimeout(250);
      }
      check(
        notes[0]?.title === 'NexaHeart' && notes[0]?.body === payload.body,
        `the notification: the community and a generic sentence (“${notes[0]?.body}”)`,
      );
      check(!JSON.stringify(notes).includes('Dan'), 'no names in it');
      check(notes[0]?.data.url === `/chat/${matchId}`, 'a tap opens the chat');

      // Off: the server forgets this browser.
      await box.click();
      await page.waitForFunction(
        (label) =>
          document
            .querySelector(`[role="checkbox"][aria-label="${label}"]`)
            ?.getAttribute('aria-checked') === 'false',
        t.push.label,
      );
      for (let i = 0; i < 20 && (await rows()).length > 0; i += 1) await page.waitForTimeout(250);
      check((await rows()).length === 0, 'turning it off removes it from the server');

      // On again, then sign out: this browser stops getting the account's notifications.
      await box.click();
      for (let i = 0; i < 40 && (await rows()).length === 0; i += 1) await page.waitForTimeout(250);
      await page.getByRole('button', { name: t.settings.signOut }).last().click();
      await page.waitForURL((url) => url.pathname === '/welcome', { timeout: 15_000 });
      check((await rows()).length === 0, 'signing out removes it too');
    } finally {
      await context.close();
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
process.stdout.write('\nNotifications in the web app: OK\n');
