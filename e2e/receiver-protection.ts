// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 65 end to end: a member limits new likes a day and accepts messages from verified members
 * only; an unverified match sees why they can't write and a way to verify; a threat to share
 * images shows the receiver an urgent banner, and "Report" opens the form with Threat chosen.
 * Usage: pnpm --dir e2e receiver-protection (API, worker and web app running)
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
const STORY: Record<L, { names: [string, string]; threat: string }> = {
  en: { names: ['Noa', 'Dan'], threat: 'Pay me 500 or I will send the video to your family.' },
  he: { names: ['נועה', 'דן'], threat: 'תשלמי 500 שקל או שאני אשלח את הסרטון לכולם.' },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));

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
    const story = STORY[locale];
    const noa = await onboardMember(`reach-${locale}`, story.names[0], 'woman', ['man']);
    const dan = await onboardMember(`reach-${locale}`, story.names[1], 'man', ['woman']);
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = await noa.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });

    // ---------------------------------------------------------- Noa: who can reach me
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/settings`);
      const heading = N.page.getByRole('heading', { name: t.reach.title });
      await heading.waitFor({ timeout: 20_000 });
      await N.page.getByRole('radio', { name: fill(t.reach.likesPerDay, { count: 25 }) }).click();
      await N.page.getByRole('checkbox', { name: t.reach.verifiedLabel }).click();
      let saved: { dailyLikeLimit: number | null; verifiedContactOnly: boolean } | undefined;
      for (let i = 0; i < 40; i += 1) {
        saved = await noa.call('GET', '/v1/me/settings');
        if (saved?.dailyLikeLimit === 25 && saved.verifiedContactOnly) break;
        await N.page.waitForTimeout(250);
      }
      check(
        saved?.dailyLikeLimit === 25 && saved.verifiedContactOnly === true,
        'the member limits new likes to 25 a day and accepts verified members only',
      );
      await heading.scrollIntoViewIfNeeded();
      await audit(N.page, `${locale}/who-can-reach-me`);
      await shot(N.page, `${locale}/148-who-can-reach-me`);
    } finally {
      await N.context.close();
    }

    // ---------------------------------------------------------- Dan, unverified, in the chat
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/chat/${matchId}`);
      const notice = D.page.getByTestId('verified-only');
      await notice.waitFor({ timeout: 20_000 });
      check(
        (await D.page.getByRole('textbox', { name: t.chat.placeholder }).count()) === 0 &&
          (await D.page.getByRole('button', { name: t.reach.verifyCta }).isVisible()),
        'an unverified match sees why, and a way to verify, instead of the message box',
      );
      await audit(D.page, `${locale}/verified-only-chat`);
      await shot(D.page, `${locale}/149-verified-only-chat`);
    } finally {
      await D.context.close();
    }

    // ---------------------------------------------------------- a threat to share images
    await noa.call('PUT', '/v1/me/settings', { verifiedContactOnly: false });
    await dan.call('POST', `/v1/matches/${matchId}/messages`, {
      text: story.threat,
      clientId: `threat-${Date.now()}`,
    });
    const N2 = await open(browser, locale, noa.session);
    try {
      await N2.page.goto(`${WEB}/chat/${matchId}`);
      const banner = N2.page.getByTestId('extortion-banner');
      await banner.waitFor({ timeout: 20_000 });
      check(
        (await banner.innerText()).includes(t.reach.extortionTitle),
        'the receiver sees the urgent banner',
      );
      await audit(N2.page, `${locale}/extortion-banner`);
      await shot(N2.page, `${locale}/150-extortion-banner`);
      await banner
        .getByRole('button', { name: fill(t.reach.extortionReport, { name: story.names[1] }) })
        .click();
      const threat = N2.page.getByRole('radio', { name: t.report.categories.threat });
      await threat.waitFor({ timeout: 20_000 });
      check(
        N2.page.url().includes(`/report/${dan.id}`) && (await threat.isChecked()),
        '"Report" opens the form with Threat chosen',
      );
    } finally {
      await N2.context.close();
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
process.stdout.write('\nProtection on the receiving side: OK\n');
