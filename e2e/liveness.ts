// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 69 end to end: a member does the live check at the pretend provider (which fetches the
 * first photo through the session) and gets the verified badge; in a chat, the verified member
 * kindly asks the match to verify, and the match sees the card.
 * Usage: pnpm --dir e2e liveness (API started with LIVENESS_URL=http://localhost:8091/check and
 * LIVENESS_SECRET, fake-liveness-provider.mjs running with the same secret, web app running)
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
    const noa = await onboardMember(`live-${locale}`, noaName, 'woman', ['man']);
    const dan = await onboardMember(`live-${locale}`, danName, 'man', ['woman']);

    // ---------------------------------------------------------- Noa's live check
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/verify`);
      const box = N.page.getByTestId('live-check');
      await box.waitFor({ timeout: 20_000 });
      await audit(N.page, `${locale}/live-check`);
      await shot(N.page, `${locale}/173-live-check`);
      await box.getByRole('button', { name: t.liveness.start }).click();
      await N.page.waitForURL(/localhost:8091\/check/, { timeout: 20_000 });
      check(
        (await N.page.locator('main').innerText()).includes('fetched: yes'),
        'the provider fetches the first photo through the session',
      );
      await N.page.getByRole('button', { name: 'Passed' }).click();
      await N.page.waitForURL(/\/verify/, { timeout: 20_000 });
      await N.page.getByText(`✓ ${t.verify.approved}`).waitFor({ timeout: 20_000 });
      check(true, 'a passed live check gives the verified badge');
      await audit(N.page, `${locale}/live-check-passed`);
    } finally {
      await N.context.close();
    }
    const me = await noa.call<{ verified: boolean }>('GET', '/v1/me');
    check(me.verified, 'the profile is verified');

    // ---------------------------------------------------------- asking Dan to verify
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = await noa.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    const N2 = await open(browser, locale, noa.session);
    try {
      await N2.page.goto(`${WEB}/chat/${matchId}`);
      const ask = N2.page.getByRole('button', { name: fill(t.askVerify.ask, { name: danName }) });
      await ask.waitFor({ timeout: 20_000 });
      await ask.click();
      await N2.page.getByText(fill(t.askVerify.asked, { name: danName })).waitFor();
      check(true, 'the member kindly asks the match to verify, once');
    } finally {
      await N2.context.close();
    }
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/chat/${matchId}`);
      const card = D.page.getByTestId('verify-asked');
      await card.waitFor({ timeout: 20_000 });
      check(
        (await card.innerText()).includes(
          fill(t.askVerify.askedMe, { name: noaName }).slice(0, 12),
        ),
        'the match sees a gentle card with a way to verify',
      );
      await audit(D.page, `${locale}/verify-asked`);
      await shot(D.page, `${locale}/174-verify-asked`);
    } finally {
      await D.context.close();
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
process.stdout.write('\nLive checks and asking to verify: OK\n');
