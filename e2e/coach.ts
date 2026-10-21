/**
 * Profile Coach end to end: tips for a thin profile, AI bio drafts from the local model
 * (on this server), using one, and the tips updating. Captures screenshots and an axe audit.
 */
import { chromium, type Browser } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { demoPhoto } from './demo-images.ts';
import { apiClient, reportA11y, shot, showcase, signInHttp, WEB } from './lib.ts';

const LEGAL = { terms: '2026-10', privacy: '2026-10' };
const content = {
  en: {
    name: 'Tamar',
    bio: 'I love to travel, just ask!',
    prompt: 'Sunrise swims at Gordon beach, then pastries and a long nap with a good book.',
  },
  he: {
    name: 'תמר',
    bio: 'אוהבת לטייל, תשאלו!',
    prompt: 'שחייה בזריחה בחוף גורדון, ואז מאפים ושנ"צ עם ספר טוב.',
  },
} as const;

async function run(locale: 'en' | 'he', browser: Browser) {
  const t = locale === 'he' ? he : en;
  const c = content[locale];
  const session = await signInHttp(`coach-${locale}-${Date.now()}@example.test`);
  const call = apiClient(session.header);
  await call('POST', '/v1/me/profile', {
    displayName: c.name,
    birthDate: '1994-02-02',
    gender: 'woman',
    interestedIn: ['man'],
    intention: 'long_term',
    bio: c.bio,
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/consents', {
    consents: [
      { kind: 'terms', granted: true, version: LEGAL.terms },
      { kind: 'privacy', granted: true, version: LEGAL.privacy },
      { kind: 'location', granted: true, version: '1' },
    ],
  });
  await call('PUT', '/v1/me/location', { lat: 32.08, lng: 34.78 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'perfect_sunday', answer: c.prompt }],
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

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: locale === 'he' ? 'he-IL' : 'en-US',
  });
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
  await context.addInitScript((l) => localStorage.setItem('dateos.locale', l), locale);
  const page = await context.newPage();
  try {
    await page.goto(`${WEB}/profile`);
    await page.getByRole('button', { name: new RegExp(t.coach.open) }).click();
    await page.getByText(t.coach.tips.bio_generic.title).waitFor();
    await shot(page, `${locale}/35-coach`);
    await page.getByRole('button', { name: t.coach.tips.bio_generic.action }).click();
    await page.getByRole('button', { name: t.editBio.getIdeas }).click();
    // The local model may return nothing usable (it is small); both outcomes are valid UI.
    const draft = page.getByRole('button', { name: t.editBio.useIdea.replace('{{n}}', '1') });
    const none = page.getByText(t.editBio.noIdeas);
    await Promise.race([draft.waitFor({ timeout: 90_000 }), none.waitFor({ timeout: 90_000 })]);
    const gotDraft = await draft.isVisible();
    process.stdout.write(
      `  local model drafts: ${gotDraft ? 'yes' : 'none (validators rejected the output)'}\n`,
    );
    await shot(page, `${locale}/36-bio-ideas`);
    if (gotDraft) await draft.click();
    else
      await page
        .getByLabel(t.editBio.label)
        .fill(
          locale === 'he'
            ? 'שוחה בזריחה בחוף גורדון כמעט כל בוקר, אחר כך מאפים וספר טוב. מחפשת מישהו שאוהב בקרים.'
            : 'I swim at sunrise at Gordon beach most mornings, then pastries and a good book. Looking for someone who likes mornings too.',
        );
    await page.getByRole('button', { name: t.editBio.save }).click();
    await page.getByText(t.coach.tips.add_photos.title).waitFor();
    await shot(page, `${locale}/37-coach-after`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of ['en', 'he'] as const) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser);
    await showcase(
      `showcase-coach-${locale}`,
      ['35-coach', '36-bio-ideas', '37-coach-after'].map((n) => `${locale}/${n}`),
    );
  }
} finally {
  await browser.close();
}
reportA11y();
