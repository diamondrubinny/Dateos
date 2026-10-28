// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from 'playwright';
import sharp from 'sharp';

export const WEB = process.env.WEB_URL ?? 'http://localhost:8081';

/** Browser locale per app language (Arabic and Hebrew are right-to-left). */
export const LOCALE_TAGS = { en: 'en-US', he: 'he-IL', ar: 'ar', ru: 'ru-RU' } as const;
export type E2eLocale = keyof typeof LOCALE_TAGS;
/** Languages to run (`LOCALES=en,he,ar,ru`); each script has its own default. */
export function locales<T extends E2eLocale>(fallback: readonly T[]): T[] {
  const wanted = process.env.LOCALES?.split(',').map((l) => l.trim());
  return (wanted ? fallback.filter((l) => wanted.includes(l)) : [...fallback]) as T[];
}
export const API = process.env.API_URL ?? 'http://localhost:4000';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;

export async function magicLink(email: string): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    ).json()) as {
      messages: { ID: string; Subject: string }[];
    };
    // Any email but the new-device alert (phase 32), which goes to the same address: the sign-in
    // link, or the "how to join" email (phase 21) when sign-up needs an invite.
    const id = list.messages.find((m) => !m.Subject.includes('New sign-in'))?.ID;
    if (id) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Text: string;
      };
      await fetch(`${MAILPIT}/api/v1/messages`, {
        method: 'DELETE',
        body: JSON.stringify({ IDs: [id] }),
      });
      return /https?:\/\/\S+/.exec(message.Text)?.[0] ?? '';
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email for ${email}`);
}

/** Signs in over HTTP (real magic link through Mailpit) and returns the session cookie value. */
export async function signInHttp(
  email: string,
  /** Another server (phase 28: a second community). */
  base: string = API,
  /** The browser string the sign-in comes from (phase 29: "Your devices" labels). */
  userAgent?: string,
): Promise<{ name: string; value: string; header: string }> {
  const request = () =>
    fetch(`${base}/v1/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB },
      body: JSON.stringify({ email, callbackURL: `${WEB}/` }),
    });
  let res = await request();
  if (res.status === 429) {
    // Every account in these scripts signs in from one IP, which the real per-IP limit
    // (5 links / 10 min) is meant to stop. Clear it on the local dev database and retry once.
    await resetSignInLimits();
    res = await request();
  }
  if (!res.ok) throw new Error(`sign-in ${res.status}: ${await res.text()}`);
  const verify = await fetch(await magicLink(email), {
    redirect: 'manual',
    ...(userAgent ? { headers: { 'user-agent': userAgent } } : {}),
  });
  const cookie = verify.headers.getSetCookie().find((c) => c.includes('session_token'));
  if (!cookie) throw new Error('no session cookie');
  const [pair] = cookie.split(';');
  const [name, value] = pair!.split('=') as [string, string];
  return { name, value, header: pair! };
}

export async function resetSignInLimits(): Promise<void> {
  const envFile = new URL('../.env', import.meta.url);
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  const { createDb } = await import('@nexaheart/db');
  const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
  try {
    await pool.query('DELETE FROM rate_limit');
  } finally {
    await pool.end();
  }
}

export function apiClient(cookie: string, base: string = API) {
  return async <T = unknown>(method: string, path: string, body?: unknown): Promise<T> => {
    const isForm = body instanceof FormData;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        cookie,
        origin: WEB,
        ...(body && !isForm ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: isForm ? body : JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  };
}

export interface A11yIssue {
  screen: string;
  id: string;
  impact: string;
  help: string;
  nodes: number;
}
export const a11yIssues: A11yIssue[] = [];

export async function audit(page: Page, screen: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  for (const v of result.violations)
    a11yIssues.push({
      screen,
      id: v.id,
      impact: v.impact ?? 'unknown',
      help: v.help,
      nodes: v.nodes.length,
    });
}

export async function shot(page: Page, file: string) {
  mkdirSync(dirname(join(OUT, file)), { recursive: true });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(400);
  const raw = await page.screenshot();
  writeFileSync(
    join(OUT, `${file}.png`),
    await sharp(raw).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer(),
  );
  await audit(page, file);
  process.stdout.write(`  ✓ ${file}.png\n`);
}

export function reportA11y(): void {
  process.stdout.write(`\naxe-core WCAG 2.1 AA: ${a11yIssues.length} violation(s)\n`);
  for (const i of a11yIssues)
    process.stdout.write(`  [${i.impact}] ${i.screen} ${i.id}: ${i.help} (${i.nodes} node(s))\n`);
  if (a11yIssues.some((i) => i.impact === 'serious' || i.impact === 'critical'))
    process.exitCode = 1;
}

/** Side-by-side strip of screenshots for the README. Missing screens are skipped. */
export async function showcase(file: string, screens: string[]) {
  const { existsSync } = await import('node:fs');
  const present = screens.filter((s) => existsSync(join(OUT, `${s}.png`)));
  const width = 300;
  const gap = 28;
  const tiles = await Promise.all(
    present.map((s) =>
      sharp(join(OUT, `${s}.png`))
        .resize({ width })
        .png()
        .toBuffer({ resolveWithObject: true }),
    ),
  );
  const height = Math.max(...tiles.map((t) => t.info.height));
  const out = await sharp({
    create: {
      width: present.length * width + (present.length + 1) * gap,
      height: height + gap * 2,
      channels: 4,
      background: '#EDE5FF',
    },
  })
    .composite(tiles.map((t, i) => ({ input: t.data, left: gap + i * (width + gap), top: gap })))
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeFileSync(join(OUT, `${file}.png`), out);
  process.stdout.write(`  ✓ ${file}.png\n`);
}

/**
 * Clears the local API's per-IP route limits (Redis `nexaheart:rl:*`). Every e2e browser comes from
 * one address, so a run over four languages reaches limits real people never share (for example 10
 * invite redemptions an hour). Local development only.
 */
export async function resetRouteLimits(): Promise<void> {
  const envFile = new URL('../.env', import.meta.url);
  if (!process.env.REDIS_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  const { Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? '');
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'nexaheart:rl:*', 'COUNT', 1000);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}

let onboarded = 0;

/**
 * A fully onboarded member over HTTP (real magic link, consents, profile, preferences, location,
 * a prompt and a photo processed by the real worker). Email addresses stay ASCII whatever the name.
 */
export async function onboardMember(
  prefix: string,
  name: string,
  gender: 'woman' | 'man',
  interestedIn: string[],
  /** Another community's API (phase 28b); by default the dev API. */
  base = API,
) {
  const { demoPhoto } = await import('./demo-images.ts');
  onboarded += 1;
  const email = `${prefix}-${gender}-${onboarded}-${Date.now()}@example.test`;
  const session = await signInHttp(email, base);
  const call = apiClient(session.header, base);
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
    birthDate: '1993-05-05',
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
    new Blob([new Uint8Array(await demoPhoto(gender === 'woman' ? 'sunset' : 'mountains'))], {
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
export type OnboardedMember = Awaited<ReturnType<typeof onboardMember>>;
