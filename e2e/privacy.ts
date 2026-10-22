/**
 * Privacy end to end: the "Privacy & cookies" page from the welcome screen, a real sign-in through
 * the UI, "Download my data" from Settings (the ZIP is opened and checked), and a comparison of what
 * the browser actually stores with the published inventory. Also fails on any request to a host
 * other than this instance's own web app and API.
 */
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { chromium, type Browser } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { storageInventory } from '../apps/mobile/src/lib/storage-inventory.ts';
import { demoPhoto } from './demo-images.ts';
import {
  API,
  apiClient,
  LOCALE_TAGS,
  locales,
  magicLink,
  reportA11y,
  shot,
  showcase,
  WEB,
} from './lib.ts';

const LEGAL = { terms: '2026-10', privacy: '2026-10' };
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const T = { en, he, ar, ru } as const;
const NAMES = { en: 'Maya', he: 'מאיה', ar: 'ليلى', ru: 'Анна' } as const;
const BIOS = {
  en: 'Coffee, the sea and live music',
  he: 'קפה, ים ומוזיקה חיה',
  ar: 'القهوة والبحر والموسيقى الحية',
  ru: 'Кофе, море и живая музыка',
} as const;

async function run(locale: keyof typeof T, browser: Browser) {
  const t = T[locale];
  const email = `privacy-${locale}-${Date.now()}@example.test`;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    acceptDownloads: true,
  });
  await context.addInitScript((l) => {
    if (!localStorage.getItem('nexaheart.locale')) localStorage.setItem('nexaheart.locale', l);
  }, locale);
  const allowed = new Set([new URL(WEB).host, new URL(API).host]);
  const foreign = new Set<string>();
  context.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && !allowed.has(u.host)) foreign.add(u.host);
  });
  const page = await context.newPage();
  try {
    await page.goto(`${WEB}/welcome`);
    await page.getByRole('link', { name: t.settings.cookies }).click();
    await page.getByText(t.cookies.summary).waitFor();
    await shot(page, `${locale}/38-cookies`);

    // Real sign-in through the UI, so the browser keeps exactly what the app sets.
    await page.goto(`${WEB}/sign-in`);
    await page.getByLabel(t.signIn.email).fill(email);
    await page.getByRole('button', { name: t.signIn.submit }).click();
    await page.getByText(t.checkEmail.title).waitFor();
    await page.goto(await magicLink(email));
    await page.waitForURL(/onboarding/);

    const session = (await context.cookies()).find((c) => c.name.includes('session_token'))!;
    const call = apiClient(`${session.name}=${session.value}`);
    await call('PUT', '/v1/me/consents', {
      consents: [
        { kind: 'terms', granted: true, version: LEGAL.terms },
        { kind: 'privacy', granted: true, version: LEGAL.privacy },
        { kind: 'sensitive', granted: true, version: '1' },
        { kind: 'location', granted: true, version: '1' },
      ],
    });
    await call('POST', '/v1/me/profile', {
      displayName: NAMES[locale],
      birthDate: '1993-05-05',
      gender: 'woman',
      interestedIn: ['man'],
      intention: 'long_term',
      bio: BIOS[locale],
      languages: ['he', 'en'],
    });
    await call('PUT', '/v1/me/location', { lat: 32.08, lng: 34.78 });
    await call('PUT', '/v1/me/prompts', {
      prompts: [{ promptKey: 'perfect_sunday', answer: 'Jaffa flea market, then hummus.' }],
    });
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(await demoPhoto('sunset'))], { type: 'image/jpeg' }),
      'me.jpg',
    );
    await call('POST', '/v1/me/photos', form);
    for (let i = 0; i < 60; i += 1) {
      const me = await call<{ photos: { status: string }[] }>('GET', '/v1/me');
      if (me.photos[0]?.status === 'clean') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    await page.goto(`${WEB}/settings`);
    const button = page.getByRole('button', { name: t.settings.download });
    await button.scrollIntoViewIfNeeded();
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    await page.getByText(t.settings.downloadDone).waitFor();
    await shot(page, `${locale}/39-download-data`);
    const files = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
    const data = JSON.parse(strFromU8(files['data.json']!));
    check(/^my-data-\d{4}-\d{2}-\d{2}\.zip$/.test(download.suggestedFilename()), 'ZIP file name');
    check(data.account?.email === email, 'export contains this account');
    check(
      Object.keys(files).some((f) => /^photos\/.+\.webp$/.test(f)),
      'export contains the photo',
    );
    check(Boolean(files['README.txt']), 'export explains its contents');

    // What the browser holds, compared with the published inventory.
    const web = storageInventory.filter((i) => i.platform === 'web');
    const cookieNames = (await context.cookies()).map((c) => c.name.replace(/^__Secure-/, ''));
    const known = new Set(web.filter((i) => i.kind === 'cookie').map((i) => i.name));
    check(
      cookieNames.every((n) => known.has(n)),
      `cookies are all in the inventory (${cookieNames.join(', ')})`,
    );
    check(
      (await context.cookies()).every((c) => c.httpOnly),
      'every cookie is HttpOnly',
    );
    const stores = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    const knownLocal = new Set(web.filter((i) => i.kind === 'localStorage').map((i) => i.name));
    check(
      stores.local.every((k) => knownLocal.has(k)),
      `localStorage keys are all in the inventory (${stores.local.join(', ')})`,
    );
    check(stores.session.length === 0, 'nothing in sessionStorage');
    check(
      foreign.size === 0,
      `no requests to other hosts${foreign.size ? `: ${[...foreign].join(', ')}` : ''}`,
    );
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser);
    await showcase(
      `showcase-privacy-${locale}`,
      ['38-cookies', '39-download-data'].map((n) => `${locale}/${n}`),
    );
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length) {
  process.stdout.write(`\n${problems.length} privacy check(s) failed\n`);
  process.exitCode = 1;
}
