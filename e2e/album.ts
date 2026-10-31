// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 66c end to end: a member keeps a private album, shares it once with a match from the chat;
 * the match opens it; when the minute is over it's closed.
 * Usage: pnpm --dir e2e album (API, worker and web app running)
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { demoPhoto } from './demo-images.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
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
type L = keyof typeof T;
const NAMES: Record<L, [string, string]> = { en: ['Noa', 'Dan'], he: ['נועה', 'דן'] };

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

async function open(browser: Browser, locale: L, session: { name: string; value: string }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [noaName, danName] = NAMES[locale];
    const noa = await onboardMember(`album-${locale}`, noaName, 'woman', ['man']);
    const dan = await onboardMember(`album-${locale}`, danName, 'man', ['woman']);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(await demoPhoto('coffee'))], { type: 'image/jpeg' }),
      'album.jpg',
    );
    await noa.call('POST', '/v1/me/album/photos', form);
    let clean = false;
    for (let i = 0; i < 60 && !clean; i += 1) {
      const album = await noa.call<{ photos: { status: string }[] }>('GET', '/v1/me/album');
      clean = album.photos[0]?.status === 'clean';
      if (!clean) await new Promise((r) => setTimeout(r, 500));
    }
    check(clean, 'an album photo is scanned and ready');
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = await noa.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });

    // ---------------------------------------------------------- Noa: her album, then share once
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/my-album`);
      await N.page.getByTestId('album-photo').first().waitFor({ timeout: 20_000 });
      await audit(N.page, `${locale}/my-album`);
      await shot(N.page, `${locale}/155-my-album`);
      await N.page.goto(`${WEB}/chat/${matchId}`);
      const row = N.page.getByTestId('my-album');
      await row.waitFor({ timeout: 20_000 });
      await row.getByRole('button', { name: t.album.mode.once, exact: true }).click();
      await row.getByText(fill(t.album.sharedBy.once, { name: danName })).waitFor();
      check(true, 'the member shares the album once from the chat');
      await audit(N.page, `${locale}/share-album`);
      await shot(N.page, `${locale}/156-share-album`);
    } finally {
      await N.context.close();
    }

    // ---------------------------------------------------------- Dan opens it, once
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/chat/${matchId}`);
      const row = D.page.getByTestId('their-album');
      await row.waitFor({ timeout: 20_000 });
      await row.getByRole('button', { name: fill(t.album.open, { name: noaName }) }).click();
      const img = D.page.getByRole('img', { name: fill(t.album.photoOf, { n: '1', total: '1' }) });
      await img.waitFor({ timeout: 20_000 });
      check(true, 'the match opens the album');
      await audit(D.page, `${locale}/album-once`);
      await shot(D.page, `${locale}/157-album-once`);
      // The minute is over.
      await pool.query(
        "UPDATE album_shares SET expires_at = now() - interval '1 second' WHERE match_id = $1",
        [matchId],
      );
      await D.page.reload();
      await D.page.getByTestId('album-closed').waitFor({ timeout: 20_000 });
      check(
        (await D.page
          .getByRole('img', { name: fill(t.album.photoOf, { n: '1', total: '1' }) })
          .count()) === 0,
        'afterwards the album is closed',
      );
    } finally {
      await D.context.close();
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
process.stdout.write('\nPrivate album: OK\n');
