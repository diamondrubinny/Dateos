/**
 * Date planner end to end, in every language: an admin adds a place in the dashboard (English and
 * Hebrew, which the dashboard supports), a member proposes a date from the chat, the other person
 * accepts it live, and the proposer opens the safety check-in already filled in.
 */
import { existsSync } from 'node:fs';
import { createDb } from '@dateos/db';
import { chromium, type Browser } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { demoPhoto } from './demo-images.ts';
import {
  apiClient,
  LOCALE_TAGS,
  locales,
  magicLink,
  reportA11y,
  shot,
  showcase,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
type Place = { name: string; area: string; category: string; note?: string; stepFree: boolean };
const DATA: Record<L, { a: string; b: string; note: string; places: Place[] }> = {
  en: {
    a: 'Maya',
    b: 'Ari',
    note: 'Coffee, then a walk by the sea?',
    places: [
      {
        name: 'Café Puaa',
        area: 'Jaffa',
        category: 'cafe',
        note: 'Busy until late',
        stepFree: false,
      },
      { name: 'HaYarkon Park', area: 'Tel Aviv', category: 'park', stepFree: true },
      { name: 'Tel Aviv Museum of Art', area: 'Tel Aviv', category: 'museum', stepFree: true },
    ],
  },
  he: {
    a: 'מאיה',
    b: 'אורי',
    note: 'קפה ואחר כך הליכה ליד הים?',
    places: [
      { name: 'קפה פועה', area: 'יפו', category: 'cafe', note: 'הומה עד מאוחר', stepFree: false },
      { name: 'פארק הירקון', area: 'תל אביב', category: 'park', stepFree: true },
      { name: 'מוזיאון תל אביב לאמנות', area: 'תל אביב', category: 'museum', stepFree: true },
    ],
  },
  ar: {
    a: 'ليلى',
    b: 'كريم',
    note: 'قهوة ثم نزهة على البحر؟',
    places: [
      {
        name: 'مقهى بوعا',
        area: 'يافا',
        category: 'cafe',
        note: 'مزدحم حتى وقت متأخر',
        stepFree: false,
      },
      { name: 'حديقة اليركون', area: 'تل أبيب', category: 'park', stepFree: true },
      { name: 'متحف تل أبيب للفنون', area: 'تل أبيب', category: 'museum', stepFree: true },
    ],
  },
  ru: {
    a: 'Анна',
    b: 'Илья',
    note: 'Кофе, а потом прогулка у моря?',
    places: [
      {
        name: 'Кафе «Пуа»',
        area: 'Яффо',
        category: 'cafe',
        note: 'Людно до позднего вечера',
        stepFree: false,
      },
      { name: 'Парк Яркон', area: 'Тель-Авив', category: 'park', stepFree: true },
      {
        name: 'Тель-Авивский музей искусств',
        area: 'Тель-Авив',
        category: 'museum',
        stepFree: true,
      },
    ],
  },
};

const ADDRESSES: Record<L, string[]> = {
  en: ['8 Rabbi Yohanan St', 'Rokach Blvd', '27 Shaul HaMelech Blvd'],
  he: ['רבי יוחנן 8', 'שדרות רוקח', 'שדרות שאול המלך 27'],
  ar: ['شارع رابي يوحنان 8', 'جادة روكاح', 'جادة شاؤول هملخ 27'],
  ru: ['ул. Раби Йоханан, 8', 'бульвар Роках', 'бульвар Шауль ха-Мелех, 27'],
};
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function account(email: string, name: string, gender: 'woman' | 'man') {
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
    birthDate: '1994-04-04',
    gender,
    interestedIn: [gender === 'woman' ? 'man' : 'woman'],
    intention: 'long_term',
    languages: ['he', 'en'],
  });
  await call('PUT', '/v1/me/location', { lat: 32.08, lng: 34.78 });
  await call('PUT', '/v1/me/prompts', {
    prompts: [{ promptKey: 'perfect_sunday', answer: 'The sea, then coffee.' }],
  });
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(await demoPhoto(gender === 'woman' ? 'sunset' : 'mountains'))], {
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

async function open(
  browser: Browser,
  session: { name: string; value: string } | null,
  locale: L,
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
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
  await context.addInitScript((l) => {
    localStorage.setItem('dateos.locale', l);
    localStorage.setItem('dateos-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

/** The dashboard is in English and Hebrew: an admin adds the last place with the form. */
async function adminAddsPlace(browser: Browser, locale: 'en' | 'he', place: Place, pool: Pool) {
  const a = adminMessages[locale];
  const email = `dates-admin-${locale}-${Date.now()}@example.test`;
  await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  await pool.query('DELETE FROM rate_limit');
  const S = await open(browser, null, locale, 1280);
  try {
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

    await S.page.getByRole('link', { name: a.venues.nav }).click();
    await S.page.getByRole('heading', { name: a.venues.title }).waitFor();
    await S.page.getByLabel(a.venues.name, { exact: true }).fill(place.name);
    await S.page.getByLabel(a.venues.area).fill(place.area);
    await S.page.getByLabel(a.venues.category).selectOption(place.category);
    await S.page.getByLabel(a.venues.address).fill(ADDRESSES[locale][2]!);
    if (place.stepFree) await S.page.getByLabel(a.venues.stepFreeLabel).check();
    await S.page.getByRole('button', { name: a.venues.add }).click();
    await S.page.getByText(a.venues.added.replace('{{name}}', place.name)).waitFor();
    const row = S.page.getByRole('rowheader', { name: new RegExp(escape(place.name)) });
    await row.waitFor({ timeout: 10_000 }).catch(() => undefined);
    check(await row.isVisible(), 'the admin added a place in the dashboard');
    await shot(S.page, `${locale}/admin-08-venues`);
  } finally {
    await S.context.close();
  }
}

type Pool = ReturnType<typeof createDb>['pool'];

async function run(locale: L, browser: Browser, pool: Pool) {
  const t = T[locale];
  const d = DATA[locale];
  const stamp = Date.now();

  // Each language starts from its own places. Date ideas keep their own copy, so this is safe.
  await pool.query('DELETE FROM venues');
  const addresses = ADDRESSES[locale];
  const viaDb = locale === 'en' || locale === 'he' ? d.places.slice(0, 2) : d.places;
  for (const [i, p] of viaDb.entries()) {
    await pool.query(
      `INSERT INTO venues (name, area, category, address, note, step_free) VALUES ($1, $2, $3, $4, $5, $6)`,
      [p.name, p.area, p.category, addresses[i], p.note ?? null, p.stepFree],
    );
  }
  if (locale === 'en' || locale === 'he') await adminAddsPlace(browser, locale, d.places[2]!, pool);

  await pool.query('DELETE FROM rate_limit');
  const a = await account(`dates-a-${locale}-${stamp}@example.test`, d.a, 'woman');
  const b = await account(`dates-b-${locale}-${stamp}@example.test`, d.b, 'man');
  await b.call('POST', '/v1/interactions', { targetId: a.id, kind: 'like' });
  const { matchId } = await a.call<{ matchId: string }>('POST', '/v1/interactions', {
    targetId: b.id,
    kind: 'like',
  });
  await b.call('POST', `/v1/matches/${matchId}/messages`, { text: '👋', clientId: `h-${stamp}` });

  const A = await open(browser, a.session, locale);
  const B = await open(browser, b.session, locale);
  try {
    await A.page.goto(`${WEB}/chat/${matchId}`);
    await A.page.getByRole('button', { name: t.datePlan.open }).click();
    await A.page.getByRole('heading', { name: t.datePlan.title }).first().waitFor();
    await A.page.getByRole('radio', { name: new RegExp(`^${escape(d.places[0]!.name)}`) }).click();
    await A.page.getByRole('radio', { name: '18:00', exact: true }).click();
    await A.page.getByLabel(t.datePlan.note).fill(d.note);
    await A.page
      .getByRole('radio', { name: new RegExp(`^${escape(d.places[0]!.name)}`) })
      .scrollIntoViewIfNeeded();
    await shot(A.page, `${locale}/44-plan-date`);
    await A.page.getByRole('button', { name: t.datePlan.send }).click();
    await A.page.getByText(t.datePlan.yourIdea).waitFor();
    check(true, 'the date idea appears in the proposer’s chat');

    await B.page.goto(`${WEB}/chat/${matchId}`);
    await B.page.getByText(t.datePlan.theirIdea).waitFor();
    check(await B.page.getByText(d.note, { exact: false }).isVisible(), 'the card shows the note');
    await shot(B.page, `${locale}/45-date-card`);
    await B.page.getByRole('button', { name: t.datePlan.accept, exact: true }).click();
    await B.page.getByText(t.datePlan.accepted).waitFor();
    await shot(B.page, `${locale}/46-date-agreed`);
    await A.page.getByText(t.datePlan.accepted).waitFor({ timeout: 10_000 });
    check(true, 'the proposer sees the acceptance live');

    await A.page.getByRole('button', { name: t.datePlan.checkin }).click();
    const place = A.page.getByLabel(t.checkin.place, { exact: true });
    await place.waitFor();
    check(
      (await place.inputValue()) ===
        t.datePlan.placeWithArea
          .replace('{{name}}', d.places[0]!.name)
          .replace('{{area}}', d.places[0]!.area),
      'the check-in is filled in with the place',
    );
    await shot(A.page, `${locale}/47-checkin-prefilled`);
  } finally {
    await A.context.close();
    await B.context.close();
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const { pool } = createDb(process.env.DATABASE_URL ?? '');
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await run(locale, browser, pool);
    await showcase(
      `showcase-date-planner-${locale}`,
      ['44-plan-date', '45-date-card', '46-date-agreed', '47-checkin-prefilled'].map(
        (n) => `${locale}/${n}`,
      ),
    );
  }
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length) {
  process.stdout.write(`\n${problems.length} check(s) failed\n${problems.join('\n')}\n`);
  process.exitCode = 1;
}
