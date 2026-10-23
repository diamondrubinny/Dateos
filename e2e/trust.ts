// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Trust and safety (phase 21) end to end in every language:
 * - In the dashboard, an admin turns on invite mode and makes a code; a new person joins with it.
 * - In waitlist mode, a new person joins the waitlist, a moderator approves them, and they join.
 * - A member adds a passkey (Chromium's virtual authenticator) and signs in with it.
 * - A member hides themselves from a contact, both ways, silently.
 * Usage: pnpm --dir e2e trust
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { demoPhoto } from './demo-images.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  apiClient,
  LOCALE_TAGS,
  locales,
  magicLink,
  reportA11y,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const API = process.env.API_URL ?? 'http://localhost:4000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
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

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
let counter = 0;
const address = (locale: L, who: string) =>
  `trust-${locale}-${who}-${(counter += 1)}-${Date.now()}@example.test`;

async function member(locale: L, name: string, gender: 'woman' | 'man', interestedIn: string[]) {
  const email = address(locale, gender);
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  await call('PUT', '/v1/me/consents', {
    consents: [
      { kind: 'terms', granted: true, version: '2026-10' },
      { kind: 'privacy', granted: true, version: '2026-10' },
      { kind: 'sensitive', granted: true, version: '1' },
      { kind: 'location', granted: true, version: '1' },
    ],
  });
  await call('POST', '/v1/me/profile', {
    displayName: name,
    birthDate: '1992-02-02',
    gender,
    interestedIn,
    intention: 'long_term',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/preferences', {
    ageMin: 18,
    ageMax: 99,
    maxDistanceKm: 50,
    intentions: [],
  });
  await call('PUT', '/v1/me/location', { lat: 32.08, lng: 34.78 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'perfect_sunday', answer: 'Coffee by the sea, then a long walk.' }],
  });
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(await demoPhoto(gender === 'woman' ? 'sunset' : 'mountain'))], {
      type: 'image/jpeg',
    }),
    'me.jpg',
  );
  await call('POST', '/v1/me/photos', form);
  for (let i = 0; i < 60; i += 1) {
    const me = await call<{ user: { id: string }; photos: { status: string }[] }>('GET', '/v1/me');
    if (me.photos[0]?.status === 'clean') return { session, call, id: me.user.id, email };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('photo was not processed');
}

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string } | null,
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    timezoneId: 'Asia/Jerusalem',
  });
  if (session) {
    await context.addCookies([
      {
        name: session.name,
        value: session.value,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  await context.addInitScript(
    ([l, dash]) => {
      localStorage.setItem('nexaheart.locale', l!);
      localStorage.setItem('nexaheart-admin-locale', dash!);
    },
    [locale, locale === 'he' ? 'he' : 'en'],
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

/** An admin in the dashboard (signed in with MFA); its page also calls the API as that admin. */
async function dashboard(browser: Browser, locale: L) {
  const a = adminMessages[locale === 'he' ? 'he' : 'en'];
  const email = address(locale, 'admin');
  await signInHttp(email); // the account exists before any mode change
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  await pool.query('DELETE FROM rate_limit');
  const S = await open(browser, locale, null, 1280);
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
  await S.page.getByRole('link', { name: a.signup.nav }).click();
  await S.page.getByRole('heading', { name: a.signup.title }).waitFor();
  return { ...S, a };
}

async function setMode(
  page: Page,
  a: (typeof adminMessages)['en'],
  mode: 'open' | 'invite' | 'waitlist',
) {
  await page.getByRole('radio', { name: a.signup.modes[mode], exact: true }).check();
  if (mode === 'invite') await page.getByRole('checkbox', { name: a.signup.memberInvites }).check();
  await page.getByRole('button', { name: a.signup.save, exact: true }).click();
  await page.getByText(a.signup.saved).waitFor();
  // The app reads the mode from /v1/instance; the server's copy refreshes at once.
}

async function joinWithLink(context: BrowserContext, email: string) {
  const page = await context.newPage();
  await page.goto(await magicLink(email));
  await page.waitForURL((url) => !url.pathname.includes('verify'));
  await page.close();
}

async function run(browser: Browser, locale: L) {
  const t = T[locale];
  const [her, him] = NAMES[locale];
  const D = await dashboard(browser, locale);
  try {
    // 1. Invite mode: the admin makes a code in the dashboard.
    await setMode(D.page, D.a, 'invite');
    await D.page.getByLabel(D.a.signup.label).fill(`Launch ${locale}`);
    await D.page.getByLabel(D.a.signup.maxUses).fill('5');
    await D.page.getByRole('button', { name: D.a.signup.create }).click();
    const code = (await D.page.getByTestId('invite-code').innerText()).trim();
    check(/^[A-HJ-NP-Z2-9]{10}$/.test(code), 'the dashboard shows the new code once');
    if (locale === 'en' || locale === 'he') await shot(D.page, `${locale}/admin-11-joining`);

    // A new person: a wrong code is refused, the right one lets them in.
    const newcomer = address(locale, 'new');
    const A = await open(browser, locale, null);
    try {
      await A.page.goto(`${WEB}/sign-in`);
      await A.page.getByLabel(t.signIn.email).fill(newcomer);
      const codeField = A.page.getByLabel(t.signup.code);
      await codeField.fill('WRONG-CODE');
      await A.page.getByRole('button', { name: t.signIn.submit }).click();
      await A.page.getByText(t.signup.badCode).waitFor();
      check(true, 'a wrong invite code is refused with a clear message');
      await codeField.fill(code.toLowerCase());
      await shot(A.page, `${locale}/74-signin-invite`);
      await A.page.getByRole('button', { name: t.signIn.submit }).click();
      await A.page.waitForURL((url) => url.pathname.startsWith('/check-email'));
      await joinWithLink(A.context, newcomer);
      const { rows } = await pool.query(`SELECT 1 FROM "user" WHERE email = $1`, [newcomer]);
      check(rows.length === 1, 'the invite code opened the account');
    } finally {
      await A.context.close();
    }

    // Without a code, a new address gets a "how to join" email instead of a link.
    const stranger = address(locale, 'stranger');
    await fetch(`${API}/v1/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB },
      body: JSON.stringify({ email: stranger, callbackURL: `${WEB}/` }),
    });
    const link = await magicLink(stranger).catch(() => null);
    check(link !== null && !link.includes('magic-link/verify'), 'no sign-in link without a code');

    // 2. Waitlist mode: join, approval in the dashboard, then the account opens.
    await setMode(D.page, D.a, 'waitlist');
    const waiting = address(locale, 'wait');
    const B = await open(browser, locale, null);
    try {
      await B.page.goto(`${WEB}/sign-in`);
      await B.page.getByRole('button', { name: t.signup.joinWaitlist }).click();
      await B.page.waitForURL((url) => url.pathname.startsWith('/waitlist'));
      await B.page.getByLabel(t.signIn.email).fill(waiting);
      await B.page.getByLabel(t.signup.note).fill('A friend told me');
      await B.page.getByRole('button', { name: t.signup.joinWaitlist }).click();
      await B.page.getByText(t.signup.waitlistDone).waitFor();
      await shot(B.page, `${locale}/75-waitlist`);

      await D.page.reload();
      const entry = D.page.locator('li.list-item', { hasText: waiting });
      await entry.waitFor();
      if (locale === 'en' || locale === 'he') await shot(D.page, `${locale}/admin-12-waitlist`);
      await entry.getByRole('button', { name: new RegExp(D.a.signup.approve) }).click();
      await D.page.getByText(waiting).first().waitFor();
      const approval = await magicLink(waiting);
      check(approval.startsWith(WEB), 'the approval email points to the app');
      await fetch(`${API}/v1/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: WEB },
        body: JSON.stringify({ email: waiting, callbackURL: `${WEB}/` }),
      });
      await joinWithLink(B.context, waiting);
      const { rows } = await pool.query(`SELECT 1 FROM "user" WHERE email = $1`, [waiting]);
      check(rows.length === 1, 'the approved person opened an account');
    } finally {
      await B.context.close();
    }
  } finally {
    await setMode(D.page, D.a, 'open').catch(() => undefined);
    await D.context.close();
  }

  // 3. Passkeys: add one in Settings, sign out, sign in with it.
  const maya = await member(locale, her, 'woman', ['man']);
  const dan = await member(locale, him, 'man', ['woman']);
  const C = await open(browser, locale, maya.session);
  try {
    const cdp = await C.context.newCDPSession(C.page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await C.page.goto(`${WEB}/settings`);
    const keys = C.page.getByTestId('passkeys');
    await keys.scrollIntoViewIfNeeded();
    await keys.getByRole('button', { name: t.passkey.add }).click();
    await keys.getByRole('button', { name: t.passkey.remove }).waitFor();
    check(true, 'a passkey was added in Settings');
    await C.page.getByRole('heading', { name: t.security.title }).scrollIntoViewIfNeeded();
    await shot(C.page, `${locale}/76-security`);

    await C.context.clearCookies();
    await C.page.goto(`${WEB}/sign-in`);
    await C.page.getByRole('button', { name: t.passkey.signIn }).click();
    await C.page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 15_000 });
    const me = await C.page.evaluate(async (api) => {
      const res = await fetch(`${api}/v1/me`, { credentials: 'include' });
      return res.ok ? ((await res.json()) as { user: { id: string } }).user.id : null;
    }, API);
    check(me === maya.id, 'signed in again with the passkey, no email needed');

    // 4. Hide me from my contacts.
    const before = await dan.call<{ profiles: { id: string }[] }>('GET', '/v1/discover?limit=50');
    check(
      before.profiles.some((p) => p.id === maya.id),
      'before: Dan can see her',
    );
    await C.page.goto(`${WEB}/hide-contacts`);
    await C.page
      .getByLabel(t.contacts.pasteLabel)
      .fill(`Dan <${dan.email.toUpperCase()}>, someone@example.test\nnot an address`);
    await C.page.getByRole('button', { name: t.contacts.hide }).click();
    await C.page.getByText(t.contacts.done.replace('{{count}}', '1')).waitFor();
    await shot(C.page, `${locale}/77-hide-contacts`);
    const after = await dan.call<{ profiles: { id: string }[] }>('GET', '/v1/discover?limit=50');
    check(!after.profiles.some((p) => p.id === maya.id), 'after: Dan doesn’t see her (silently)');
    const hers = await maya.call<{ profiles: { id: string }[] }>('GET', '/v1/discover?limit=50');
    check(!hers.profiles.some((p) => p.id === dan.id), 'and she doesn’t see him');
    const stored = await pool.query(
      `SELECT count(*)::int AS n FROM contact_hides WHERE user_id = $1`,
      [maya.id],
    );
    check(stored.rows[0].n === 1, 'only the match is stored, nothing about the other address');
  } finally {
    await C.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await pool.query('DELETE FROM rate_limit');
    await run(browser, locale);
  }
} finally {
  await pool.query(`UPDATE instance_settings SET signup_mode = 'open', member_invites = false`);
  await browser.close();
  await pool.end();
}
reportA11y();
process.stdout.write(
  problems.length ? `\n${problems.length} problem(s)\n` : '\nall checks passed\n',
);
if (problems.length) process.exitCode = 1;
