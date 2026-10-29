// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 47 accessibility sweep: the main screens in dark mode (and a few in light mode with the
 * keyboard), with real content in them (a chat with date ideas, an active check-in). axe-core on
 * each, and the keyboard focus ring drawn away from the control.
 * Usage: pnpm --dir e2e a11y-dark
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
import {
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  OUT,
  reportA11y,
  resetSignInLimits,
  shot,
  WEB,
  type OnboardedMember,
} from './lib.ts';

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

type L = 'en' | 'he';
async function open(
  browser: Browser,
  locale: L,
  member: OnboardedMember,
  colorScheme: 'light' | 'dark',
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    colorScheme,
  });
  const { name, value } = member.session;
  await context.addCookies([
    { name, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
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
    const maya = await onboardMember(`dark-${locale}`, locale === 'he' ? 'מאיה' : 'Maya', 'woman', [
      'man',
    ]);
    const dan = await onboardMember(`dark-${locale}`, locale === 'he' ? 'דן' : 'Dan', 'man', [
      'woman',
    ]);
    // Content: a match, messages, a declined idea and an open one, an active check-in.
    await dan.call('POST', '/v1/interactions', { targetId: maya.id, kind: 'like' });
    const { matchId } = await maya.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    const stamp = Date.now();
    await dan.call('POST', `/v1/matches/${matchId}/messages`, {
      text: locale === 'he' ? 'היי! איך עובר השבוע?' : 'Hi! How’s your week going?',
      clientId: `dark-a-${stamp}`,
    });
    await maya.call('POST', `/v1/matches/${matchId}/messages`, {
      text: locale === 'he' ? 'טוב! קפה בשבוע הבא?' : 'Good! Coffee next week?',
      clientId: `dark-b-${stamp}`,
    });
    const { rows: venue } = await pool.query<{ id: string }>(
      `INSERT INTO venues (name, area, category, address, step_free)
       VALUES ($1, 'Jaffa', 'cafe', 'Rabbi Yohanan St 8', true) RETURNING id`,
      [`Café Puaa ${locale} ${stamp % 100000}`],
    );
    const at = (days: number) => {
      const d = new Date(Date.now() + days * 86_400_000);
      d.setHours(19, 0, 0, 0);
      return d.toISOString();
    };
    const first = await dan.call<{ date: { id: string } }>('POST', `/v1/matches/${matchId}/dates`, {
      venueId: venue[0]!.id,
      startsAt: at(2),
      clientId: `dark-d1-${stamp}`,
    });
    await maya.call('POST', `/v1/dates/${first.date.id}/decline`);
    await dan.call('POST', `/v1/matches/${matchId}/dates`, {
      venueId: venue[0]!.id,
      startsAt: at(3),
      clientId: `dark-d2-${stamp}`,
    });
    await maya.call('POST', '/v1/me/checkins', {
      place: 'Café Puaa, Jaffa',
      startsAt: new Date().toISOString(),
      checkAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      contactName: 'Dana',
      contactEmail: `dark-${stamp}@example.test`,
      locale,
      timeZone: 'Asia/Jerusalem',
    });

    const screens = [
      '/discover',
      '/likes',
      '/matches',
      '/profile',
      '/preview',
      `/chat/${matchId}`,
      `/date/${matchId}`,
      '/checkin',
      '/settings',
      '/preferences',
      '/privacy',
      '/accessibility',
      '/display',
      '/events',
      '/blocked',
      '/change-email',
      '/edit-about',
      `/profile/${dan.id}?matchId=${matchId}`,
    ];
    const D = await open(browser, locale, maya, 'dark');
    try {
      for (const path of screens) {
        await D.page.goto(`${WEB}${path}`);
        await D.page.waitForLoadState('networkidle');
        await D.page.waitForTimeout(300);
        await audit(D.page, `${locale}/dark${path.split('?')[0]}`);
      }
      check(true, `${screens.length} screens audited in dark mode`);
      await D.page.goto(`${WEB}/chat/${matchId}`);
      await D.page.waitForLoadState('networkidle');
      await shot(D.page, `${locale}/122-dark-chat`);
      await D.page.goto(`${WEB}/checkin`);
      await D.page.waitForLoadState('networkidle');
      await shot(D.page, `${locale}/123-dark-checkin`);
    } finally {
      await D.context.close();
    }

    // The keyboard focus ring, in both modes: 3 px, drawn 2 px away from the control.
    for (const scheme of ['light', 'dark'] as const) {
      const K = await open(browser, locale, maya, scheme);
      try {
        await K.page.goto(`${WEB}/settings`);
        await K.page.waitForLoadState('networkidle');
        let ring = { width: '0px', offset: '0px', style: 'none' };
        for (let i = 0; i < 40; i++) {
          await K.page.keyboard.press('Tab');
          ring = await K.page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            const s = el ? getComputedStyle(el) : null;
            return {
              width: s?.outlineWidth ?? '0px',
              offset: s?.outlineOffset ?? '0px',
              style: s?.outlineStyle ?? 'none',
            };
          });
          if (ring.style === 'solid' && ring.width === '3px') break;
        }
        check(
          ring.style === 'solid' && ring.width === '3px' && ring.offset === '2px',
          `${scheme}: the focus ring is 3 px, 2 px away (${ring.width}, ${ring.offset})`,
        );
        if (scheme === 'light') {
          // Not shot(): it clears focus first, and the ring is the point of this picture.
          writeFileSync(
            join(OUT, `${locale}/124-focus-ring.png`),
            await sharp(await K.page.screenshot())
              .png({ compressionLevel: 9, palette: true, quality: 90 })
              .toBuffer(),
          );
          check(true, `${locale}/124-focus-ring.png`);
        }
      } finally {
        await K.context.close();
      }
    }
  }
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nAccessibility sweep: OK\n');
