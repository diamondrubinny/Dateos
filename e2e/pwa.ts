// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 57 end to end, on the built web app (pnpm build:web, served by serve-web.mjs as Caddy does):
 * the manifest carries the community's branding and Chrome finds the app installable; the service
 * worker controls the page and keeps only the app's own files, never the API's; with the
 * connection gone the app still opens and says the community can't be reached, then carries on by
 * itself; an older copy is removed.
 * Usage: pnpm --dir e2e pwa
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
  API,
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

await resetSignInLimits();
const instance = (await (await fetch(`${API}/v1/instance`)).json()) as { name: string };
// 0. Installable: Chrome's own check. It never offers installing in an incognito-like context, so
// this one uses a normal (temporary) browser profile.
{
  process.stdout.write('install:\n');
  const profile = mkdtempSync(join(tmpdir(), 'nexaheart-pwa-'));
  const persistent = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = persistent.pages()[0] ?? (await persistent.newPage());
    await page.goto(`${WEB}/welcome`);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    const cdp = await persistent.newCDPSession(page);
    let errors: string[] = ['not checked'];
    // The worker takes the page a moment after the reload: ask until Chrome has settled.
    for (let i = 0; i < 10 && errors.length > 0; i += 1) {
      const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
        installabilityErrors: { errorId: string }[];
      };
      errors = installabilityErrors.map((e) => e.errorId);
      if (errors.length > 0) await page.waitForTimeout(1000);
    }
    check(errors.length === 0, `Chrome finds the app installable (${errors.join(', ')})`);
  } finally {
    await persistent.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const member = await onboardMember(`pwa-${locale}`, 'Noa', 'woman', ['man']);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: LOCALE_TAGS[locale],
    });
    await context.addCookies([
      {
        name: member.session.name,
        value: member.session.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
    // A copy left by an "older build": made on the first visit only, before the app's worker runs.
    await context.addInitScript(() => {
      if (!navigator.serviceWorker.controller) void caches.open('nexaheart-app-0000000000000000');
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      // 1. The worker installs and takes the page.
      await page.goto(`${WEB}/`);
      await page.waitForURL((url) => url.pathname === '/discover', { timeout: 20_000 });
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await page.reload();
      await page.waitForURL((url) => url.pathname === '/discover', { timeout: 20_000 });
      check(
        await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        'the service worker controls the app',
      );

      // 2. The manifest, as Chrome reads it, and Chrome's own installability check.
      const cdp = await context.newCDPSession(page);
      const manifest = (await cdp.send('Page.getAppManifest')) as {
        url: string;
        errors: { message: string }[];
        data?: string;
      };
      const data = JSON.parse(manifest.data ?? '{}') as { name?: string; display?: string };
      check(manifest.url.endsWith('/manifest.webmanifest'), 'the page links the manifest');
      check(
        manifest.errors.length === 0,
        `the manifest has no errors (${manifest.errors.map((e) => e.message).join('; ')})`,
      );
      check(data.name === instance.name, `it carries the community’s name (${data.name})`);

      // 3. What it keeps: this build's own files only, never the API's, and the old copy is gone.
      const kept = await page.evaluate(async () => {
        const names = await caches.keys();
        const urls: string[] = [];
        for (const name of names) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) urls.push(request.url);
        }
        return { names, urls };
      });
      check(
        kept.names.length === 1 && /^nexaheart-app-[0-9a-f]{16}$/.test(kept.names[0]!),
        `one copy, this build’s; the older one was removed (${kept.names.join(', ')})`,
      );
      const origin = new URL(WEB).origin;
      check(
        kept.urls.length > 0 &&
          kept.urls.every((u) => {
            const url = new URL(u);
            return (
              url.origin === origin &&
              (url.pathname === '/index.html' ||
                /^\/(_expo\/static|assets|icons)\//.test(url.pathname))
            );
          }),
        `only the app’s own files (${kept.urls.length})`,
      );
      check(!kept.urls.some((u) => u.startsWith(API)), 'nothing from the API');

      // 4. No connection: the app still opens, and says so; then carries on by itself.
      await context.setOffline(true);
      await page.reload();
      await page.getByText(t.server.unreachableTitle).first().waitFor({ timeout: 20_000 });
      check(true, 'opens without a connection, with the “can’t reach” screen');
      check(!page.url().includes('/welcome'), 'not sent to the welcome page');
      await audit(page, `${locale}/pwa-offline`);
      await shot(page, `${locale}/137-pwa-offline`);
      await context.setOffline(false);
      await page.waitForURL((url) => url.pathname === '/discover', { timeout: 30_000 });
      check(true, 'carries on when the connection is back');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nInstallable web app: OK\n');
