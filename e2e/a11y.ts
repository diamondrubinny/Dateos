/**
 * Accessibility checks that axe-core does not cover, in English and Hebrew:
 * - keyboard only: welcome → sign-in → "check your email" with Tab and Enter, and a visible focus
 *   indicator on every element that receives focus;
 * - reflow (WCAG 1.4.10): no horizontal scrolling at 320 CSS px;
 * - text resize (WCAG 1.4.4): at 200% text size nothing is clipped horizontally;
 * - reduced motion: no running animations when the system asks for less motion;
 * - document language and direction (lang / dir).
 */
import { chromium, type Browser, type Page } from 'playwright';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import { locales, WEB } from './lib.ts';

const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const RTL = new Set<L>(['he', 'ar']);

const PUBLIC_SCREENS = ['/welcome', '/sign-in', '/privacy', '/terms', '/accessibility', '/cookies'];
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

/**
 * True when focus changes how the element looks (outline, ring, border or background): its style
 * while focused is compared with the same element after blur, then focus is restored.
 */
async function focusVisible(page: Page): Promise<{ visible: boolean; label: string }> {
  const handle = await page.evaluateHandle(() => document.activeElement as HTMLElement | null);
  const el = handle.asElement();
  if (!el) return { visible: false, label: '(nothing focused)' };
  const signature = () =>
    el.evaluate((node) => {
      const s = getComputedStyle(node);
      return [
        s.outlineStyle,
        s.outlineWidth,
        s.outlineColor,
        s.boxShadow,
        s.borderColor,
        s.backgroundColor,
      ].join('|');
    });
  const label = await el.evaluate((node) =>
    (node.getAttribute('aria-label') ?? node.textContent ?? node.tagName).trim().slice(0, 40),
  );
  if (label === '' || (await el.evaluate((node) => node === document.body))) {
    return { visible: false, label: '(body)' };
  }
  const focused = await signature();
  await el.evaluate((node) => node.blur());
  await page.waitForTimeout(80);
  const blurred = await signature();
  await el.evaluate((node) => node.focus());
  await page.waitForTimeout(80);
  return { visible: focused !== blurred, label };
}

async function keyboardFlow(browser: Browser, locale: L) {
  const t = T[locale];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  try {
    await page.goto(`${WEB}/welcome`);
    await page.getByRole('button', { name: t.welcome.start }).waitFor();
    const lang = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
    }));
    check(
      lang.lang === locale && lang.dir === (RTL.has(locale) ? 'rtl' : 'ltr'),
      `lang="${lang.lang}" dir="${lang.dir}"`,
    );

    // Tab until "Get started" has focus, checking every stop shows focus.
    const invisible: string[] = [];
    let reached = false;
    for (let i = 0; i < 25 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      const f = await focusVisible(page);
      if (!f.visible) invisible.push(f.label);
      reached = f.label === t.welcome.start;
    }
    check(reached, 'keyboard reaches "Get started"');
    check(
      invisible.length === 0,
      `focus is visible at every stop${invisible.length ? `: ${invisible.join(' | ')}` : ''}`,
    );
    await page.keyboard.press('Enter');
    await page.getByLabel(t.signIn.email, { exact: true }).waitFor();

    let onEmail = false;
    for (let i = 0; i < 15 && !onEmail; i += 1) {
      await page.keyboard.press('Tab');
      onEmail = await page.evaluate(
        (label) =>
          document.activeElement?.getAttribute('aria-label') === label ||
          (document.activeElement as HTMLInputElement | null)?.labels?.[0]?.textContent?.includes(
            label,
          ) === true ||
          document.activeElement?.tagName === 'INPUT',
        t.signIn.email,
      );
    }
    check(onEmail, 'keyboard reaches the email field');
    await page.keyboard.type(`a11y-${locale}-${Date.now()}@example.test`);
    await page.keyboard.press('Enter'); // submits from the field
    const submitted = await page
      .getByText(t.checkEmail.title)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check(submitted, 'Enter in the email field sends the link');
  } finally {
    await context.close();
  }
}

async function layoutChecks(browser: Browser, locale: L) {
  for (const mode of ['reflow-320', 'text-200'] as const) {
    const context = await browser.newContext({
      viewport: mode === 'reflow-320' ? { width: 320, height: 640 } : { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
    const page = await context.newPage();
    try {
      for (const path of PUBLIC_SCREENS) {
        await page.goto(`${WEB}${path}`);
        await page.waitForLoadState('networkidle');
        if (mode === 'text-200') {
          // Browser text zoom: every font size doubled, layout width unchanged.
          await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
          await page.evaluate(() => {
            for (const el of document.querySelectorAll<HTMLElement>('body *')) {
              const size = parseFloat(getComputedStyle(el).fontSize);
              if (size && !el.dataset.zoomed) {
                el.style.fontSize = `${size * 2}px`;
                el.style.lineHeight = 'normal';
                el.dataset.zoomed = '1';
              }
            }
          });
          await page.waitForTimeout(200);
        }
        const overflow = await page.evaluate(() => {
          const doc = document.scrollingElement!;
          return doc.scrollWidth - doc.clientWidth;
        });
        check(overflow <= 1, `${mode} ${path}: no horizontal scrolling (${overflow}px)`);
        if (mode === 'reflow-320') {
          const animations = await page.evaluate(
            () => document.getAnimations().filter((a) => a.playState === 'running').length,
          );
          check(animations === 0, `reduced motion ${path}: ${animations} running animation(s)`);
        }
      }
    } finally {
      await context.close();
    }
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he', 'ar', 'ru'] as const)) {
    process.stdout.write(`${locale}:\n`);
    await keyboardFlow(browser, locale);
    await layoutChecks(browser, locale);
  }
} finally {
  await browser.close();
}
process.stdout.write(
  problems.length ? `\n${problems.length} problem(s)\n` : '\nall accessibility checks passed\n',
);
if (problems.length) process.exitCode = 1;
