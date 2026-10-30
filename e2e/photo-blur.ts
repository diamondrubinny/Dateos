// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 66a end to end: a member blurs their photos in Settings; a match sees the photo blurred
 * and why; the member shows their photos to that match from the chat; the match sees them.
 * Usage: pnpm --dir e2e photo-blur (API, worker and web app running)
 */
import { chromium, type Browser } from 'playwright';
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

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [noaName, danName] = NAMES[locale];
    const noa = await onboardMember(`blur-${locale}`, noaName, 'woman', ['man']);
    const dan = await onboardMember(`blur-${locale}`, danName, 'man', ['woman']);

    // ---------------------------------------------------------- Noa blurs her photos
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/settings`);
      const box = N.page.getByRole('checkbox', { name: t.blur.settingLabel });
      await box.waitFor({ timeout: 20_000 });
      await box.click();
      let on = false;
      for (let i = 0; i < 40 && !on; i += 1) {
        on = (await noa.call<{ blurPhotos: boolean }>('GET', '/v1/me/settings')).blurPhotos;
        if (!on) await N.page.waitForTimeout(250);
      }
      check(on, 'the member blurs their photos in Settings');
    } finally {
      await N.context.close();
    }
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = await noa.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });

    // ---------------------------------------------------------- Dan sees it blurred
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/profile/${noa.id}`);
      const note = D.page.getByTestId('photo-blurred');
      await note.waitFor({ timeout: 20_000 });
      check(
        (await note.innerText()).includes(fill(t.blur.byChoice, { name: noaName })),
        'a match sees the photo blurred, and why',
      );
      await audit(D.page, `${locale}/photo-blurred`);
      await shot(D.page, `${locale}/151-photo-blurred`);
    } finally {
      await D.context.close();
    }

    // ---------------------------------------------------------- Noa shows them from the chat
    const N2 = await open(browser, locale, noa.session);
    try {
      await N2.page.goto(`${WEB}/chat/${matchId}`);
      const row = N2.page.getByTestId('photos-shown');
      await row.waitFor({ timeout: 20_000 });
      await audit(N2.page, `${locale}/show-my-photos`);
      await shot(N2.page, `${locale}/152-show-my-photos`);
      await row.getByRole('button', { name: fill(t.blur.showTo, { name: danName }) }).click();
      await N2.page.getByText(fill(t.blur.shownTo, { name: danName })).waitFor();
      check(true, 'the member shows their photos to this match');
    } finally {
      await N2.context.close();
    }
    const D2 = await open(browser, locale, dan.session);
    try {
      await D2.page.goto(`${WEB}/profile/${noa.id}`);
      await D2.page.getByRole('img').first().waitFor({ timeout: 20_000 });
      await D2.page.waitForTimeout(1000);
      check(
        (await D2.page.getByTestId('photo-blurred').count()) === 0,
        'the match now sees the photo',
      );
    } finally {
      await D2.context.close();
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
process.stdout.write('\nBlurred photos: OK\n');
