// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Two real accounts chat live in two browsers (WebSocket, no reloads). Asserts the safety
 * features end to end and captures screenshots + an axe-core audit for each locale.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { demoPhoto } from './demo-images.ts';
import {
  apiClient,
  LOCALE_TAGS,
  locales,
  OUT,
  reportA11y,
  shot,
  showcase,
  signInHttp,
  WEB,
} from './lib.ts';

const LEGAL = { terms: '2026-10', privacy: '2026-10' };

const scripts = {
  en: {
    t: en,
    a: {
      name: 'Maya',
      gender: 'woman',
      interestedIn: ['man'],
      prompt: ['first_date_idea', 'Hummus by the beach, then a sunset walk.'],
    },
    b: {
      name: 'Ari',
      gender: 'man',
      interestedIn: ['woman'],
      prompt: ['perfect_sunday', 'Long run by the sea, then pancakes with friends.'],
    },
    replies: [
      'Haha yes! Pancakes are non-negotiable 🥞',
      'What about you, beach or mountains?',
      'Same! Coffee this week?',
    ],
    mine: ['Beach, always 🌊', 'I know a great café in Jaffa', 'Thursday works for me'],
    harmful: 'you are an idiot',
    scam: 'Can you send me money for my flight ticket?',
    bio: 'Into the sea, coffee and good conversations.',
  },
  he: {
    t: he,
    a: {
      name: 'נועה',
      gender: 'woman',
      interestedIn: ['man'],
      prompt: ['first_date_idea', 'חומוס על החוף ואז הליכה בשקיעה.'],
    },
    b: {
      name: 'אורי',
      gender: 'man',
      interestedIn: ['woman'],
      prompt: ['perfect_sunday', 'ריצה ארוכה ליד הים ואז פנקייקים עם חברים.'],
    },
    replies: ['חחח כן! פנקייקים זה חובה 🥞', 'ומה איתך, ים או הרים?', 'גם אני! קפה השבוע?'],
    mine: ['ים, תמיד 🌊', 'אני מכיר בית קפה מעולה ביפו', 'יום חמישי מתאים לי'],
    harmful: 'את פשוט מטומטמת',
    scam: 'תעבירי לי כסף בביט לכרטיס טיסה?',
    bio: 'אוהב/ת ים, קפה ושיחות טובות.',
  },
  ar: {
    t: ar,
    a: {
      name: 'ليلى',
      gender: 'woman',
      interestedIn: ['man'],
      prompt: ['first_date_idea', 'حمّص على الشاطئ ثم نزهة وقت الغروب.'],
    },
    b: {
      name: 'كريم',
      gender: 'man',
      interestedIn: ['woman'],
      prompt: ['perfect_sunday', 'ركض طويل على البحر ثم فطائر مع الأصدقاء.'],
    },
    replies: [
      'هههه نعم! الفطائر ضرورية 🥞',
      'وأنتِ، البحر أم الجبال؟',
      'وأنا أيضًا! قهوة هذا الأسبوع؟',
    ],
    mine: ['البحر دائمًا 🌊', 'أعرف مقهى رائعًا في يافا', 'يوم الخميس يناسبني'],
    harmful: 'انتِ غبية فعلًا',
    scam: 'ارسلي لي المال لتذكرة الطيران من فضلك',
    bio: 'أحب البحر والقهوة والأحاديث الجميلة.',
  },
  ru: {
    t: ru,
    a: {
      name: 'Анна',
      gender: 'woman',
      interestedIn: ['man'],
      prompt: ['first_date_idea', 'Хумус на пляже, а потом прогулка на закате.'],
    },
    b: {
      name: 'Илья',
      gender: 'man',
      interestedIn: ['woman'],
      prompt: ['perfect_sunday', 'Долгая пробежка у моря, а потом блины с друзьями.'],
    },
    replies: [
      'Ха-ха, да! Без блинов никак 🥞',
      'А вы — море или горы?',
      'Я тоже! Кофе на этой неделе?',
    ],
    mine: ['Море, всегда 🌊', 'Знаю отличное кафе в Яффо', 'Четверг мне подходит'],
    harmful: 'Ты просто идиотка',
    scam: 'Переведи деньги на билет, пожалуйста',
    bio: 'Люблю море, кофе и хорошие разговоры.',
  },
} as const;

type Person = (typeof scripts)[keyof typeof scripts]['a' | 'b'];

async function createAccount(email: string, p: Person, locale: string) {
  const session = await signInHttp(email);
  const call = apiClient(session.header);
  await call('PUT', '/v1/me/consents', {
    consents: [
      { kind: 'terms', granted: true, version: LEGAL.terms },
      { kind: 'privacy', granted: true, version: LEGAL.privacy },
      { kind: 'sensitive', granted: true, version: '1' },
      { kind: 'location', granted: true, version: '1' },
    ],
  });
  await call('POST', '/v1/me/profile', {
    displayName: p.name,
    birthDate: '1995-05-05',
    gender: p.gender,
    interestedIn: p.interestedIn,
    intention: 'long_term',
    bio: scripts[locale as keyof typeof scripts].bio,
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/location', { lat: 32.0809, lng: 34.7806 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: p.prompt[0], answer: p.prompt[1] }],
  });
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(await demoPhoto(p.gender === 'woman' ? 'sunset' : 'mountains'))], {
      type: 'image/jpeg',
    }),
    'me.jpg',
  );
  await call('POST', '/v1/me/photos', form);
  for (let i = 0; i < 60; i += 1) {
    const me = await call<{ user: { id: string }; photos: { status: string }[] }>('GET', '/v1/me');
    if (me.photos[0]?.status === 'clean') return { session, call, id: me.user.id };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('photo was not processed');
}

async function openAs(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  cookie: { name: string; value: string },
  locale: string,
) {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale,
  });
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.addInitScript(
    (l) => localStorage.setItem('nexaheart.locale', l),
    locale.slice(0, 2),
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => process.stderr.write(`pageerror: ${e.message}\n`));
  return { context, page };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function sendFromUi(page: Page, t: typeof en, text: string) {
  await page.getByLabel(t.chat.messageLabel, { exact: true }).fill(text);
  await page.getByRole('button', { name: t.chat.send, exact: true }).click();
}

async function run(
  locale: keyof typeof scripts,
  browser: Awaited<ReturnType<typeof chromium.launch>>,
) {
  const s = scripts[locale];
  mkdirSync(join(OUT, locale), { recursive: true });
  const stamp = Date.now().toString(36);
  const a = await createAccount(`chat-a-${locale}-${stamp}@example.com`, s.a, locale);
  const b = await createAccount(`chat-b-${locale}-${stamp}@example.com`, s.b, locale);
  await b.call('POST', '/v1/interactions', { targetId: a.id, kind: 'like' });
  const { matchId } = await a.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: b.id,
    kind: 'like',
  });
  assert(matchId, 'mutual like creates a match');

  const A = await openAs(browser, a.session, LOCALE_TAGS[locale]);
  const B = await openAs(browser, b.session, LOCALE_TAGS[locale]);
  try {
    await scenario(locale, matchId, A.page, B.page);
  } catch (error) {
    // Keep evidence of what each browser showed when a step failed.
    const dir = process.env.FAILURE_DIR ?? '/tmp';
    await A.page.screenshot({ path: `${dir}/chat-failure-${locale}-A.png` }).catch(() => undefined);
    await B.page.screenshot({ path: `${dir}/chat-failure-${locale}-B.png` }).catch(() => undefined);
    process.stderr.write(`Failure screenshots saved in ${dir}\n`);
    throw error;
  } finally {
    await a.call('DELETE', '/v1/me').catch(() => undefined);
    await b.call('DELETE', '/v1/me').catch(() => undefined);
    await A.context.close();
    await B.context.close();
  }
}

async function scenario(locale: keyof typeof scripts, matchId: string, aPage: Page, bPage: Page) {
  const s = scripts[locale];
  const t = s.t;
  const A = { page: aPage };
  const B = { page: bPage };
  await A.page.goto(`${WEB}/matches`);
  await A.page.getByText(t.chat.newMatch).waitFor();
  await shot(A.page, `${locale}/17-inbox-new-match`);

  await A.page.goto(`${WEB}/chat/${matchId}`);
  await B.page.goto(`${WEB}/chat/${matchId}`);
  // Icebreakers quote the other person's own prompt answer.
  const suggestion = A.page
    .getByRole('button', { name: new RegExp(s.b.prompt[1].slice(0, 12)) })
    .first();
  await suggestion.waitFor();
  await shot(A.page, `${locale}/18-chat-icebreakers`);
  await suggestion.click();
  await A.page.getByRole('button', { name: t.chat.send, exact: true }).click();

  // Real time: B receives it without reloading.
  await B.page.getByText(s.b.prompt[1].slice(0, 12)).first().waitFor({ timeout: 5_000 });
  for (let i = 0; i < 3; i += 1) {
    await sendFromUi(B.page, t, s.replies[i]!);
    await A.page.getByText(s.replies[i]!).waitFor({ timeout: 5_000 });
    await sendFromUi(A.page, t, s.mine[i]!);
    await B.page.getByText(s.mine[i]!).waitFor({ timeout: 5_000 });
  }
  await A.page.waitForTimeout(500);
  await shot(B.page, `${locale}/19-chat-live`);
  const seen = await A.page.getByText(`✓✓ ${t.chat.seen}`).isVisible();
  assert(seen, 'read receipt shown to the sender');

  // "Are you sure?" for the sender, hidden for the receiver.
  await B.page.getByLabel(t.chat.messageLabel, { exact: true }).fill(s.harmful);
  await B.page.getByRole('button', { name: t.chat.send, exact: true }).click();
  await B.page.getByText(t.chat.sureTitle).waitFor();
  await shot(B.page, `${locale}/20-chat-are-you-sure`);
  await B.page.getByRole('button', { name: t.chat.sendAnyway }).click();
  await A.page.getByText(t.chat.hidden).waitFor({ timeout: 5_000 });
  assert(
    !(await A.page.getByText(s.harmful).isVisible()),
    'harmful message hidden for the receiver',
  );

  // Scam warning for the receiver only.
  await sendFromUi(B.page, t, s.scam);
  await A.page.getByText(t.chat.scamTitle).waitFor({ timeout: 5_000 });
  assert(
    !(await B.page.getByText(t.chat.scamTitle).isVisible()),
    'sender does not see the scam banner',
  );
  await shot(A.page, `${locale}/21-chat-safety`);

  // Images are unlocked now (3+3). B sends a photo; A sees it blurred after the scan.
  const chooser = B.page.waitForEvent('filechooser');
  await B.page.getByRole('button', { name: t.chat.sendImage }).click();
  await (
    await chooser
  ).setFiles({ name: 'beach.jpg', mimeType: 'image/jpeg', buffer: await demoPhoto('sunset') });
  await A.page.getByRole('button', { name: t.chat.tapToView }).waitFor({ timeout: 30_000 });
  await A.page.waitForTimeout(800);
  await shot(A.page, `${locale}/22-chat-blurred-photo`);

  await A.page.goto(`${WEB}/matches`);
  await A.page.getByText(s.b.name).first().waitFor();
  await shot(A.page, `${locale}/23-inbox`);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser);
    await showcase(
      `showcase-chat-${locale}`,
      [
        '18-chat-icebreakers',
        '19-chat-live',
        '20-chat-are-you-sure',
        '21-chat-safety',
        '22-chat-blurred-photo',
      ].map((n) => `${locale}/${n}`),
    );
  }
} finally {
  await browser.close();
}
reportA11y();
