// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 68c end to end: an admin turns on approval of new profiles; a new member waits; a
 * moderator asks for a change; the member sends it again; it's approved. Then a member suggests
 * two of their friends to each other, and one of them sees it came from a friend.
 * Usage: pnpm --dir e2e friend-suggestions (API, worker, web app and dashboard running)
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
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
  WEB,
} from './lib.ts';

const T = { en, he } as const;
type L = keyof typeof T;
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const NAMES: Record<L, { ron: string; maya: string; noa: string; dan: string }> = {
  en: { ron: 'Ron', maya: 'Maya', noa: 'Noa', dan: 'Dan' },
  he: { ron: 'רון', maya: 'מאיה', noa: 'נועה', dan: 'דן' },
};
const NOTE: Record<L, string> = {
  en: 'You both make the best shakshuka I know.',
  he: 'השקשוקה של שניכם היא הטובה ביותר שאני מכירה.',
};
const CHANGE: Record<L, string> = {
  en: 'Please add a photo where your face shows.',
  he: 'כדאי להוסיף תמונה שרואים בה את הפנים.',
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string },
  desktop = false,
) {
  const context = await browser.newContext({
    viewport: desktop ? { width: 1280, height: 1000 } : { width: 390, height: 844 },
    deviceScaleFactor: desktop ? 1 : 2,
    locale: LOCALE_TAGS[locale],
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function adminSession() {
  const email = `review-admin-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

type Me = { review: { status: string; reason: string | null } };

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const boss = await adminSession();
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale].reviews;
    const names = NAMES[locale];
    // Earlier runs' waiting profiles stay out of this queue.
    await pool.query(
      `UPDATE profiles SET review_status = 'approved' WHERE review_status <> 'approved'`,
    );

    // ---------------------------------------------------------- approval on, in the dashboard
    const S = await open(browser, locale, boss.session, true);
    try {
      await S.page.goto(`${ADMIN}/#/reviews`);
      const box = S.page.getByLabel(a.settingLabel);
      await box.waitFor({ timeout: 20_000 });
      if (!(await box.isChecked())) await box.check();
      await S.page.getByRole('button', { name: a.save, exact: true }).click();
      await S.page.getByText(a.saved).waitFor();
      check(true, 'an admin turns on approval of new profiles');
    } finally {
      await S.context.close();
    }

    // ---------------------------------------------------------- a new member waits
    const ron = await onboardMember(`review-${locale}`, names.ron, 'man', ['woman']);
    const R = await open(browser, locale, ron.session);
    try {
      await R.page.goto(`${WEB}/discover`);
      const banner = R.page.getByTestId('review-banner');
      await banner.waitFor({ timeout: 20_000 });
      check(
        (await banner.innerText()).includes(t.review.pendingTitle),
        'the new member sees that the profile is waiting',
      );
      await audit(R.page, `${locale}/review-pending`);
      await shot(R.page, `${locale}/167-review-pending`);
    } finally {
      await R.context.close();
    }

    // ---------------------------------------------------------- a moderator asks for a change
    const M = await open(browser, locale, boss.session, true);
    try {
      await M.page.goto(`${ADMIN}/#/reviews`);
      const card = M.page.getByTestId('pending-profile');
      await card.first().waitFor({ timeout: 20_000 });
      await M.page.getByRole('button', { name: fill(a.ask, { name: names.ron }) }).click();
      await M.page.getByLabel(a.reasons.photos, { exact: true }).check();
      await M.page.getByLabel(a.note).fill(CHANGE[locale]);
      await audit(M.page, `${locale}/admin-reviews`);
      await shot(M.page, `${locale}/admin-39-reviews`);
      await M.page.getByRole('button', { name: fill(a.send, { name: names.ron }) }).click();
      await M.page.getByText(a.empty).waitFor();
      check(true, 'a moderator asks for a change, with a reason and a note');
    } finally {
      await M.context.close();
    }

    const R2 = await open(browser, locale, ron.session);
    try {
      await R2.page.goto(`${WEB}/discover`);
      const banner = R2.page.getByTestId('review-banner');
      await banner.getByText(CHANGE[locale]).waitFor({ timeout: 20_000 });
      check(
        (await banner.innerText()).includes(
          fill(t.review.changesTitle, { reason: t.review.reasons.photos }),
        ),
        'the member sees what to change and the note',
      );
      await banner.getByRole('button', { name: t.review.resubmit }).click();
      await R2.page.getByText(t.review.pendingTitle).waitFor({ timeout: 20_000 });
      check(true, 'the member sends it again');
    } finally {
      await R2.context.close();
    }
    await boss.call('POST', `/v1/admin/profile-reviews/${ron.id}`, { decision: 'approve' });
    check(
      (await ron.call<Me>('GET', '/v1/me')).review.status === 'approved',
      'approved: others can find the profile now',
    );
    await boss.call('PATCH', '/v1/admin/instance', { profileApproval: false });

    // ---------------------------------------------------------- a friend suggests a pair
    const maya = await onboardMember(`friends-${locale}`, names.maya, 'woman', ['man']);
    const noa = await onboardMember(`friends-${locale}`, names.noa, 'woman', ['man']);
    const dan = await onboardMember(`friends-${locale}`, names.dan, 'man', ['woman']);
    for (const other of [noa.id, dan.id]) {
      const [x, y] = [maya.id, other].sort();
      await pool.query(`INSERT INTO matches (user_a, user_b, mode) VALUES ($1, $2, 'friend')`, [
        x,
        y,
      ]);
    }
    const F = await open(browser, locale, maya.session);
    try {
      await F.page.goto(`${WEB}/suggest-friends`);
      await F.page.getByTestId('suggest-friend').first().waitFor({ timeout: 20_000 });
      for (const name of [names.noa, names.dan]) {
        await F.page.getByRole('checkbox', { name: fill(t.console.choose, { name }) }).click();
      }
      await F.page.getByLabel(t.console.note).fill(NOTE[locale]);
      await audit(F.page, `${locale}/suggest-friends`);
      await shot(F.page, `${locale}/168-suggest-friends`);
      await F.page.getByRole('button', { name: t.console.send }).click();
      await F.page.getByText(t.console.sent).waitFor({ timeout: 20_000 });
      check(true, 'a member suggests two friends to each other');
    } finally {
      await F.context.close();
    }
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/introductions`);
      const card = N.page.getByTestId('introduction');
      await card.waitFor({ timeout: 20_000 });
      const text = await card.innerText();
      check(
        text.includes(fill(t.suggest.fromFriend, { name: names.maya })) &&
          text.includes(NOTE[locale]) &&
          !text.includes(t.intro.notAnymore),
        'the friend sees it came from a friend, with the note',
      );
      await audit(N.page, `${locale}/friend-suggestion`);
      await shot(N.page, `${locale}/169-friend-suggestion`);
    } finally {
      await N.context.close();
    }
  }
} finally {
  await boss.call('PATCH', '/v1/admin/instance', { profileApproval: false }).catch(() => {});
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nFriends who suggest and profile approval: OK\n');
