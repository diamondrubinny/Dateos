/**
 * Captures real screenshots of the web build by walking the full flow against a running
 * stack: API, worker, Mailpit and the exported web app (see README "Screenshots").
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { demoPhoto, demoScenes } from './demo-images.ts';

const WEB = process.env.WEB_URL ?? 'http://localhost:8081';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;

const people = {
  en: {
    t: en,
    name: 'Maya',
    email: 'maya@example.com',
    birth: ['14', '03', '1996'],
    bio: 'Architect by day, amateur baker by night. Into long walks by the sea and terrible puns.',
    prompts: {
      first_date_idea: 'Hummus by the beach, then a sunset walk on the promenade.',
      green_flag: 'You’re kind to waiters and curious about everything.',
    },
  },
  he: {
    t: he,
    name: 'נועה',
    email: 'noa@example.com',
    birth: ['14', '03', '1996'],
    bio: 'אדריכלית ביום, אופה חובבת בלילה. אוהבת הליכות ארוכות ליד הים ומשחקי מילים גרועים.',
    prompts: {
      first_date_idea: 'חומוס על החוף ואז הליכה בטיילת בשקיעה.',
      green_flag: 'אדיבות למלצרים וסקרנות לגבי הכול.',
    },
  },
} as const;

async function magicLink(email: string): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    ).json()) as {
      messages: { ID: string }[];
    };
    const id = list.messages[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Text: string;
      };
      return /https?:\/\/\S+/.exec(message.Text)![0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email for ${email}`);
}

interface A11yIssue {
  screen: string;
  id: string;
  impact: string;
  help: string;
  nodes: number;
}
const a11yIssues: A11yIssue[] = [];

/** Automated WCAG 2.1 A/AA scan (axe-core). Catches a subset of issues; manual testing is still required. */
async function audit(page: Page, screen: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  for (const v of result.violations) {
    a11yIssues.push({
      screen,
      id: v.id,
      impact: v.impact ?? 'unknown',
      help: v.help,
      nodes: v.nodes.length,
    });
  }
}

async function shot(page: Page, locale: string, name: string) {
  // Drop focus left by the last click so screenshots show the resting state.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(400); // let fonts, images and transitions settle
  const raw = await page.screenshot();
  const file = join(OUT, locale, `${name}.png`);
  writeFileSync(
    file,
    await sharp(raw).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer(),
  );
  await audit(page, `${locale}/${name}`);
  process.stdout.write(`  ✓ ${locale}/${name}.png\n`);
}

async function run(locale: keyof typeof people) {
  const { t, name, email, birth, bio, prompts } = people[locale];
  const p = t.onboarding.profile;
  mkdirSync(join(OUT, locale), { recursive: true });
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: locale === 'he' ? 'he-IL' : 'en-US',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => process.stderr.write(`pageerror: ${e.message}\n`));
  await page.addInitScript((l) => localStorage.setItem('dateos.locale', l), locale);

  await page.goto(`${WEB}/`);
  await page.getByRole('button', { name: t.welcome.start }).waitFor();
  await shot(page, locale, '01-welcome');

  await page.getByRole('button', { name: t.welcome.start }).click();
  await page.getByLabel(t.signIn.email, { exact: true }).fill(email);
  await shot(page, locale, '02-sign-in');
  await page.getByRole('button', { name: t.signIn.submit }).click();
  await page.getByText(t.checkEmail.title).first().waitFor();
  await shot(page, locale, '03-check-email');

  await page.goto(await magicLink(email)); // API verifies the link, sets the cookie, redirects back
  await page.getByLabel(p.name, { exact: true }).waitFor();
  await page.getByLabel(p.name, { exact: true }).fill(name);
  await page.getByLabel(p.day, { exact: true }).fill(birth[0]);
  await page.getByLabel(p.month, { exact: true }).fill(birth[1]);
  await page.getByLabel(p.year, { exact: true }).fill(birth[2]);
  await page.getByRole('radio', { name: t.gender.woman, exact: true }).click();
  await page.getByRole('checkbox', { name: t.gender.man, exact: true }).click();
  await page.getByRole('radio', { name: t.intention.long_term, exact: true }).click();
  await page.getByLabel(new RegExp(`^${p.bio}`)).fill(bio);
  await page.getByLabel(p.name, { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, locale, '04-profile');
  await page.getByRole('button', { name: t.common.continue }).click();

  await page.getByRole('checkbox', { name: new RegExp(`^${t.onboarding.consents.terms}`) }).click();
  await page
    .getByRole('checkbox', { name: new RegExp(`^${t.onboarding.consents.privacy}`) })
    .click();
  await shot(page, locale, '05-consents');
  await page.getByRole('button', { name: t.common.continue }).click();

  const add = page.getByRole('button', { name: t.onboarding.photos.add, exact: true });
  await add.waitFor();
  for (const scene of demoScenes) {
    const chooser = page.waitForEvent('filechooser');
    await add.click();
    await (
      await chooser
    ).setFiles({ name: `${scene}.jpg`, mimeType: 'image/jpeg', buffer: await demoPhoto(scene) });
    await page.waitForTimeout(300);
  }
  // Wait until the worker has scanned and re-encoded every photo.
  await page.waitForFunction(
    (n) => document.querySelectorAll('img[src*="/v1/photos/"]').length >= n,
    demoScenes.length,
    {
      timeout: 60_000,
    },
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLImageElement>('img[src*="/v1/photos/"]')].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  await shot(page, locale, '06-photos');
  await page.getByRole('button', { name: t.common.continue }).click();

  for (const [key, answer] of Object.entries(prompts)) {
    const label = t.prompt[key as keyof typeof t.prompt];
    await page.getByRole('checkbox', { name: label, exact: true }).click();
    await page.getByRole('textbox', { name: label, exact: true }).fill(answer);
  }
  await page
    .getByRole('textbox', { name: t.prompt.first_date_idea, exact: true })
    .scrollIntoViewIfNeeded();
  await shot(page, locale, '07-prompts');
  await page.getByRole('button', { name: t.onboarding.done }).click();

  await page.getByText(t.home.readyTitle).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLImageElement>('img')].every((img) => img.complete),
  );
  await shot(page, locale, '08-home');

  await page.getByRole('button', { name: t.home.settings }).click();
  await page.getByText(t.settings.deleteAccount).waitFor();
  await page.getByRole('button', { name: t.settings.support }).first().scrollIntoViewIfNeeded();
  await shot(page, locale, '09-settings');

  // Clean up: deleting the demo account also exercises the deletion flow end to end.
  await page.getByRole('button', { name: t.settings.deleteAccount }).click();
  await page.getByRole('button', { name: t.settings.deleteConfirm }).click();
  await page.getByRole('button', { name: t.welcome.start }).waitFor();

  await browser.close();
}

async function showcase(locale: string, names: string[]) {
  const width = 300;
  const gap = 28;
  const tiles = await Promise.all(
    names.map((n) =>
      sharp(join(OUT, locale, `${n}.png`))
        .resize({ width })
        .png()
        .toBuffer({ resolveWithObject: true }),
    ),
  );
  const height = Math.max(...tiles.map((tile) => tile.info.height));
  const canvas = sharp({
    create: {
      width: names.length * width + (names.length + 1) * gap,
      height: height + gap * 2,
      channels: 4,
      background: '#EDE5FF',
    },
  });
  const out = await canvas
    .composite(
      tiles.map((tile, i) => ({ input: tile.data, left: gap + i * (width + gap), top: gap })),
    )
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeFileSync(join(OUT, `showcase-${locale}.png`), out);
  process.stdout.write(`  ✓ showcase-${locale}.png\n`);
}

for (const locale of ['en', 'he'] as const) {
  process.stdout.write(`${locale}:\n`);
  await run(locale);
  await showcase(locale, ['01-welcome', '04-profile', '06-photos', '07-prompts', '08-home']);
}

process.stdout.write(`\naxe-core WCAG 2.1 AA: ${a11yIssues.length} violation(s)\n`);
for (const i of a11yIssues)
  process.stdout.write(`  [${i.impact}] ${i.screen} ${i.id}: ${i.help} (${i.nodes} node(s))\n`);
if (a11yIssues.some((i) => i.impact === 'serious' || i.impact === 'critical')) process.exitCode = 1;
