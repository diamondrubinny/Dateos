// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { TextModel } from '@nexaheart/ai';
import { existsSync } from 'node:fs';
import { runMigrations } from '@nexaheart/db';
import {
  SENSITIVE_CONSENT_VERSION,
  type DeleteObjectsJob,
  type ProcessAudioJob,
  type ProcessPhotoJob,
  type AlertJob,
  type PushJob,
  type WebhookJob,
} from '@nexaheart/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Redis } from 'ioredis';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import type { MailMessage, Mailer } from '../../src/lib/mailer.js';
import type { MediaQueue, ProfileQueue } from '../../src/lib/queue.js';
import type { CallMedia } from '../../src/lib/livekit.js';
import { createServices, type Services } from '../../src/services.js';

/** A well-formed (made-up) VAPID public key: the API only hands it to browsers. */
export const TEST_WEB_PUSH_KEY = `B${'A'.repeat(86)}`;
/** Phase 63: a pretend age-check provider (never a real secret). */
export const TEST_AGE_CHECK = {
  AGE_CHECK_URL: 'https://age.example.test/check',
  AGE_CHECK_SECRET: 'test-only-age-check-secret-0123456789abcdef',
};

export const integrationEnabled = process.env.INTEGRATION === '1';

export interface TestContext {
  app: FastifyInstance;
  env: Env;
  services: Services;
  redis: Redis;
  mail: MailMessage[];
  jobs: {
    process: ProcessPhotoJob[];
    audio: ProcessAudioJob[];
    delete: DeleteObjectsJob[];
    embed: string[];
    push: PushJob[];
    webhooks: WebhookJob[];
    alerts: AlertJob[];
    /** Clips queued for a transcript (phase 26). */
    transcripts: string[];
  };
  today: { value: string };
  /** Clock used for TOTP checks; advance it by 30 s to get a fresh code. */
  clock: { value: number };
}

/**
 * Tests wipe data between cases, so they must never touch the developer's own data: they use a
 * separate database (`<name>_test`, created on demand), Redis database 15 and separate buckets.
 */
async function isolatedResources(
  databaseUrl: string,
  redisUrl: string,
  second?: SetupOptions['second'],
) {
  const db = new URL(databaseUrl);
  const testName = `${db.pathname.slice(1)}_test${second ? `_${second.suffix}` : ''}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${testName.replace(/"/g, '')}"`);
  } finally {
    await admin.end();
  }
  db.pathname = `/${testName}`;
  const redis = new URL(redisUrl);
  redis.pathname = `/${second?.redisDb ?? 15}`;
  return { DATABASE_URL: db.toString(), REDIS_URL: redis.toString() };
}

/** LiveKit settings for suites that test calls (the media server itself is faked). */
export const TEST_LIVEKIT = {
  LIVEKIT_URL: 'wss://rtc.example.test',
  LIVEKIT_API_KEY: 'test-livekit-key',
  LIVEKIT_API_SECRET: 'test-livekit-secret-0123456789abcdef',
};

export interface SetupOptions {
  /** Updates (phase 53): the commit this test server "runs" (default: unknown). */
  appCommit?: string;
  /** Phase 60: the server's Web Push public key; '' turns web notifications off. */
  webPushKey?: string;
  /** Phase 63: an age-check provider (TEST_AGE_CHECK) for this suite. */
  ageCheck?: boolean;
  /** Text AI model for this suite (default: none). */
  /** Pass undefined to use the dashboard's model (phase 24). */
  textModel?: TextModel | null | undefined;
  /** Media server for calls (default: none, calls unavailable). */
  callMedia?: CallMedia | null;
  /** Integrations (phase 24): the network the integrations reach (default: none, all refused). */
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
  /** What the server's environment sets (default: nothing, so every integration is editable). */
  integrationsEnv?: Record<string, string | undefined>;
  integrationsKey?: Buffer | null;
  /** Voice transcripts (phase 26): on by default, as `TRANSCRIPTS=local`. */
  transcripts?: boolean;
  /** Communities that connect (phase 28): off by default, as in production. */
  federation?: boolean;
  /**
   * A second, separate server (phase 28b: two communities in one test): its own database
   * (`<name>_test_<suffix>`), Redis database and buckets, and its own address.
   */
  second?: { suffix: string; redisDb: number; apiUrl: string };
  /** This server's address (default http://localhost:4000). */
  apiUrl?: string;
}

/** A fixed key for the tests' encrypted integration secrets. */
export const TEST_INTEGRATIONS_KEY = Buffer.alloc(32, 7);

export async function setupIntegration(options: SetupOptions = {}): Promise<TestContext> {
  const envFile = new URL('../../../../.env', import.meta.url);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const isolated = await isolatedResources(
    process.env.DATABASE_URL ?? '',
    process.env.REDIS_URL ?? '',
    options.second,
  );
  const buckets = options.second ? `nexaheart-test-${options.second.suffix}` : 'nexaheart-test';
  const env = loadEnv({
    ...process.env,
    ...isolated,
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    WS_HEARTBEAT_MS: '200',
    // The SSRF guard is under test: never inherit a developer's local opt-out.
    INTEGRATIONS_ALLOW_PRIVATE: 'false',
    TRANSCRIPTS: options.transcripts === false ? 'off' : 'local',
    FEDERATION: options.federation ? 'on' : 'off',
    CORS_ORIGINS: 'http://localhost:8081',
    PUBLIC_API_URL: options.second?.apiUrl ?? options.apiUrl ?? 'http://localhost:4000',
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    S3_BUCKET_QUARANTINE: `${buckets}-quarantine`,
    S3_BUCKET_MEDIA: `${buckets}-media`,
    ...(options.callMedia ? TEST_LIVEKIT : {}),
    APP_COMMIT: options.appCommit ?? '',
    UPDATE_CHECK: 'on',
    UPDATE_EMAILS: 'on',
    WEB_PUSH_PUBLIC_KEY: options.webPushKey ?? TEST_WEB_PUSH_KEY,
    ...(options.ageCheck ? TEST_AGE_CHECK : {}),
  });
  await runMigrations(env.DATABASE_URL);

  const mail: MailMessage[] = [];
  const mailer: Mailer = { send: async (m) => void mail.push(m), close: () => undefined };
  const jobs: TestContext['jobs'] = {
    process: [],
    audio: [],
    delete: [],
    embed: [],
    push: [],
    webhooks: [],
    alerts: [],
    transcripts: [],
  };
  const profileQueue: ProfileQueue = {
    embedProfile: async (userId) => void jobs.embed.push(userId),
    close: async () => undefined,
  };
  const mediaQueue: MediaQueue = {
    processPhoto: async (job) => void jobs.process.push(job),
    processAudio: async (job) => void jobs.audio.push(job),
    deleteObjects: async (job) => void jobs.delete.push(job),
    close: async () => undefined,
  };
  const today = { value: '2026-10-20' };
  const clock = { value: Date.parse('2026-10-20T10:00:00Z') };
  const redis = new Redis(env.REDIS_URL);
  const services = createServices(
    env,
    redis,
    (error) => {
      throw error;
    },
    {
      mailer,
      mediaQueue,
      profileQueue,
      notifyQueue: { push: async (job) => void jobs.push.push(job), close: async () => undefined },
      today: () => today.value,
      now: () => clock.value,
      ...('textModel' in options
        ? options.textModel !== undefined
          ? { textModel: options.textModel }
          : {}
        : { textModel: null }),
      callMedia: options.callMedia ?? null,
      integrationsEnv: options.integrationsEnv ?? {},
      integrationsKey:
        options.integrationsKey !== undefined ? options.integrationsKey : TEST_INTEGRATIONS_KEY,
      transcribeQueue:
        options.transcripts === false
          ? null
          : {
              transcribe: async (audioId) => void jobs.transcripts.push(audioId),
              close: async () => undefined,
            },
      outboundQueue: {
        webhook: async (job) => void jobs.webhooks.push(job),
        alert: async (job) => void jobs.alerts.push(job),
        close: async () => undefined,
      },
      fetch:
        options.fetch ??
        ((async () => {
          throw new Error('No network in tests.');
        }) as unknown as typeof fetch),
      resolve: options.resolve ?? (async () => ['93.184.216.34']),
    },
  );
  await services.storage.ensureBuckets();
  const app = await buildApp(env, { dependencies: services.dependencies, redis, services });
  return { app, env, services, redis, mail, jobs, today, clock };
}

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.services.dbHandle.pool.query(
    'TRUNCATE "user", verification, rate_limit, audit_logs, banned_emails, banned_photo_hashes, instance_settings, venues, events, integrations, webhook_deliveries, federation_keys, federation_partners, federation_aliases, federation_decisions, federation_matches RESTART IDENTITY CASCADE',
  );
  const { storage } = ctx.services;
  for (const bucket of Object.values(storage.buckets)) {
    for (const prefix of ['photos/', 'audio/', 'evidence/']) {
      await storage.delete(bucket, await storage.listKeys(bucket, prefix));
    }
  }
  const keys = await ctx.redis.keys('nexaheart:*');
  if (keys.length > 0) await ctx.redis.del(...keys);
  ctx.services.instance.invalidate();
  ctx.services.integrations.store.invalidate();
  ctx.jobs.webhooks.length = 0;
  ctx.jobs.alerts.length = 0;
  ctx.jobs.transcripts.length = 0;
  ctx.mail.length = 0;
  ctx.jobs.process.length = 0;
  ctx.jobs.delete.length = 0;
  ctx.jobs.embed.length = 0;
  ctx.jobs.audio.length = 0;
  ctx.jobs.push.length = 0;
  ctx.today.value = '2026-10-20';
  ctx.clock.value = Date.parse('2026-10-20T10:00:00Z');
}

export async function teardown(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  ctx.redis.disconnect();
}

function cookieHeader(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

/** Full magic-link flow: request a link, "click" it, return the session cookie. */
export async function signIn(
  ctx: TestContext,
  email: string,
  options: { userAgent?: string } = {},
): Promise<string> {
  const before = ctx.mail.length;
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/magic-link',
    headers: { origin: 'http://localhost:8081' },
    payload: { email, callbackURL: 'http://localhost:8081/' },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  await new Promise((r) => setTimeout(r, 20));
  // The sign-in email (other emails, like a new-device alert, have no link).
  const message = ctx.mail
    .slice(before)
    .find((m) => m.to === email && /https?:\/\/\S+/.test(m.text));
  if (!message) throw new Error('no magic link email captured');
  const link = new URL(/https?:\/\/\S+/.exec(message.text)![0]);
  const verify = await ctx.app.inject({
    method: 'GET',
    url: `${link.pathname}${link.search}`,
    ...(options.userAgent ? { headers: { 'user-agent': options.userAgent } } : {}),
  });
  if (verify.statusCode !== 302)
    throw new Error(`verify failed: ${verify.statusCode} ${verify.body}`);
  const cookie = cookieHeader(verify);
  if (!cookie.includes('session_token')) throw new Error('no session cookie set');
  return cookie;
}

/** The consents onboarding requires before a profile can be saved (terms, privacy, sensitive data). */
export async function acceptConsents(ctx: TestContext, cookie: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'PUT',
    url: '/v1/me/consents',
    headers: { cookie },
    payload: {
      consents: [
        { kind: 'terms', granted: true, version: ctx.env.TERMS_VERSION },
        { kind: 'privacy', granted: true, version: ctx.env.PRIVACY_VERSION },
        { kind: 'sensitive', granted: true, version: SENSITIVE_CONSENT_VERSION },
      ],
    },
  });
  if (res.statusCode !== 200) throw new Error(`consents: ${res.body}`);
}

export const validProfile = {
  displayName: 'Noa',
  birthDate: '1995-04-12',
  gender: 'woman',
  interestedIn: ['man', 'woman'],
  intention: 'long_term',
  bio: 'Coffee, hiking and bad puns.',
  languages: ['he', 'en'],
};
