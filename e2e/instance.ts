// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * A brand-new instance behind the production web server (Caddy, HTTPS): the operator signs in,
 * claims the instance with the setup token, sets up TOTP, brands it, uploads a logo, and the
 * member app shows the branding. Needs a fresh stack (see docs/SELF_HOSTING.md, "Test locally").
 *
 *   DOMAIN=nexaheart.test SETUP_TOKEN=... pnpm --filter @nexaheart/e2e instance
 */
import sharp from 'sharp';
import { chromium, type Browser } from 'playwright';
import { totp } from '../apps/api/src/lib/totp.ts';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { magicLink, reportA11y, shot, showcase } from './lib.ts';

const DOMAIN = process.env.DOMAIN ?? 'nexaheart.test';
const TOKEN = process.env.SETUP_TOKEN ?? '';
const APP = `https://${DOMAIN}`;
const ADMIN = `https://admin.${DOMAIN}`;
const BRAND = {
  name: 'Ahava TLV',
  tagline: 'Dating for Tel Aviv, run by volunteers.',
  color: '#0F766E',
  operator: 'Ahava Community Association',
  contact: 'hello@ahava.example',
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function logo(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" rx="96" fill="#0F766E"/>
    <path d="M256 400 C120 300 96 220 150 170 C200 125 245 150 256 185 C267 150 312 125 362 170 C416 220 392 300 256 400Z" fill="#fff"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer(); // a PNG: the server refuses SVG uploads
}

async function context(browser: Browser, locale: string, colorScheme: 'light' | 'dark' = 'light') {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true, // local test CA; production uses Let's Encrypt
    locale,
    colorScheme,
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(
    (l) => {
      localStorage.setItem('nexaheart.locale', l);
      localStorage.setItem('nexaheart-admin-locale', l);
    },
    locale.slice(0, 2),
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => process.stderr.write(`pageerror: ${e.message}\n`));
  return { ctx, page };
}

assert(TOKEN.length >= 24, 'SETUP_TOKEN is required');
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    `--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1, MAP *.${DOMAIN} 127.0.0.1`,
    // Talk to the local web server directly, never through an outbound proxy.
    '--no-proxy-server',
  ],
});

try {
  const a = adminMessages.en;
  const { ctx, page } = await context(browser, 'en-US');
  // Operator: sign in on the dashboard of the fresh instance.
  await page.goto(ADMIN);
  await page.getByLabel(a.signIn.email).fill('owner@ahava.example');
  await page.getByRole('button', { name: a.signIn.submit }).click();
  await page.getByText(a.signIn.sent).waitFor();
  await page.goto(await magicLink('owner@ahava.example'));

  // Claim with the setup token printed by install.sh.
  await page.getByRole('heading', { name: a.setup.title }).waitFor();
  await shot(page, 'en/setup-01-claim');
  await page.getByLabel(a.setup.token).fill('this-is-not-the-right-token-123');
  await page.getByRole('button', { name: a.setup.submit }).click();
  await page.getByText(a.setup.invalid).waitFor();
  await page.getByLabel(a.setup.token).fill(TOKEN);
  await page.getByRole('button', { name: a.setup.submit }).click();

  // Mandatory TOTP for the new admin.
  await page.getByRole('button', { name: a.mfa.start }).click();
  const secret = (await page.locator('code.secret').innerText()).replace(/\s/g, '');
  await page.getByLabel(a.mfa.code).fill(totp(secret, Date.now()));
  await page.getByRole('button', { name: a.mfa.submit }).click();

  // Branding wizard: a too-light color is refused with an explanation, then a real brand.
  await page.getByRole('heading', { name: a.branding.wizardTitle }).waitFor();
  await page.getByLabel(a.branding.name).fill(BRAND.name);
  await page.getByLabel(a.branding.tagline).fill(BRAND.tagline);
  await page.getByLabel(a.branding.color, { exact: true }).fill('#FACC15');
  await page.getByText(a.branding.contrastBad).waitFor();
  assert(
    await page.getByRole('button', { name: a.branding.save }).isDisabled(),
    'save disabled for low contrast',
  );
  await page.getByLabel(a.branding.color, { exact: true }).fill(BRAND.color);
  await page.getByText(a.branding.contrastOk).waitFor();
  await page.getByLabel(a.branding.operator).fill(BRAND.operator);
  await page.getByLabel(a.branding.contact).fill(BRAND.contact);
  await page.getByLabel(a.branding.sponsor).fill('');
  await shot(page, 'en/setup-02-branding');
  await page.getByRole('button', { name: a.branding.save }).click();
  await page.getByText(a.branding.done).waitFor();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: a.branding.upload }).click();
  await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await logo() });
  await page.getByText(a.branding.logoPending).waitFor();
  // The worker scans and re-encodes the logo; then the public instance info links it.
  let logoUrl: string | null = null;
  for (let i = 0; i < 60 && !logoUrl; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    logoUrl = await page.evaluate(
      async (url) => ((await (await fetch(url)).json()) as { logoUrl: string | null }).logoUrl,
      `https://api.${DOMAIN}/v1/instance`,
    );
  }
  assert(logoUrl, 'logo processed');
  await page.getByRole('button', { name: a.branding.continue }).click();
  await page.getByRole('heading', { name: a.reports.title }).waitFor();
  await page.goto(`${ADMIN}/#/branding`);
  await page.getByRole('img', { name: a.branding.logoAlt }).waitFor();
  await shot(page, 'en/setup-03-branding-saved');
  await ctx.close();

  // Members see the branding (cache on the API is 15 s).
  await new Promise((r) => setTimeout(r, 16_000));
  for (const [locale, t] of [
    ['en', en],
    ['he', he],
  ] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      const m = await context(browser, locale === 'he' ? 'he-IL' : 'en-US', scheme);
      await m.page.setViewportSize({ width: 390, height: 844 });
      await m.page.goto(`${APP}/welcome`);
      await m.page.getByText(BRAND.name).first().waitFor();
      await m.page.getByText(BRAND.tagline).waitFor();
      await m.page.locator('img').first().waitFor();
      assert((await m.page.title()) === BRAND.name, 'browser title uses the instance name');
      await shot(m.page, `${locale}/setup-04-welcome-${scheme}`);
      if (scheme === 'light') {
        await m.page.goto(`${APP}/accessibility`);
        await m.page.getByText(BRAND.contact).waitFor();
        await m.page.getByText(t.legal.operatorTitle).waitFor();
        await shot(m.page, `${locale}/setup-05-accessibility`);
      }
      await m.ctx.close();
    }
  }
  for (const locale of ['en', 'he'] as const) {
    await showcase(`showcase-instance-${locale}`, [
      `${locale}/setup-04-welcome-light`,
      `${locale}/setup-04-welcome-dark`,
      `${locale}/setup-05-accessibility`,
    ]);
  }
} catch (error) {
  const dir = process.env.FAILURE_DIR ?? '/tmp';
  for (const c of browser.contexts()) {
    for (const [i, p] of c.pages().entries()) {
      await p.screenshot({ path: `${dir}/instance-${i}.png` }).catch(() => undefined);
    }
  }
  throw error;
} finally {
  await browser.close();
}
reportA11y();
