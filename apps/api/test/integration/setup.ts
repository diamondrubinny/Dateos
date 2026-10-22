import type { TextModel } from '@nexaheart/ai';
import { existsSync } from 'node:fs';
import { runMigrations } from '@nexaheart/db';
import {
  SENSITIVE_CONSENT_VERSION,
  type DeleteObjectsJob,
  type ProcessAudioJob,
  type ProcessPhotoJob,
  type PushJob,
} from '@nexaheart/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Redis } from 'ioredis';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import type { MailMessage, Mailer } from '../../src/lib/mailer.js';
import type { MediaQueue, ProfileQueue } from '../../src/lib/queue.js';
import { createServices, type Services } from '../../src/services.js';

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
  };
  today: { value: string };
  /** Clock used for TOTP checks; advance it by 30 s to get a fresh code. */
  clock: { value: number };
}

/**
 * Tests wipe data between cases, so they must never touch the developer's own data: they use a
 * separate database (`<name>_test`, created on demand), Redis database 15 and separate buckets.
 */
async function isolatedResources(databaseUrl: string, redisUrl: string) {
  const db = new URL(databaseUrl);
  const testName = `${db.pathname.slice(1)}_test`;
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
  redis.pathname = '/15';
  return { DATABASE_URL: db.toString(), REDIS_URL: redis.toString() };
}

export interface SetupOptions {
  /** Text AI model for this suite (default: none). */
  textModel?: TextModel | null;
}

export async function setupIntegration(options: SetupOptions = {}): Promise<TestContext> {
  const envFile = new URL('../../../../.env', import.meta.url);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const isolated = await isolatedResources(
    process.env.DATABASE_URL ?? '',
    process.env.REDIS_URL ?? '',
  );
  const env = loadEnv({
    ...process.env,
    ...isolated,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    WS_HEARTBEAT_MS: '200',
    CORS_ORIGINS: 'http://localhost:8081',
    PUBLIC_API_URL: 'http://localhost:4000',
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    S3_BUCKET_QUARANTINE: 'nexaheart-test-quarantine',
    S3_BUCKET_MEDIA: 'nexaheart-test-media',
  });
  await runMigrations(env.DATABASE_URL);

  const mail: MailMessage[] = [];
  const mailer: Mailer = { send: async (m) => void mail.push(m), close: () => undefined };
  const jobs: TestContext['jobs'] = { process: [], audio: [], delete: [], embed: [], push: [] };
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
      textModel: options.textModel ?? null,
    },
  );
  await services.storage.ensureBuckets();
  const app = await buildApp(env, { dependencies: services.dependencies, redis, services });
  return { app, env, services, redis, mail, jobs, today, clock };
}

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.services.dbHandle.pool.query(
    'TRUNCATE "user", verification, rate_limit, audit_logs, banned_emails, instance_settings, venues, events RESTART IDENTITY CASCADE',
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
export async function signIn(ctx: TestContext, email: string): Promise<string> {
  const before = ctx.mail.length;
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/magic-link',
    headers: { origin: 'http://localhost:8081' },
    payload: { email, callbackURL: 'http://localhost:8081/' },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  await new Promise((r) => setTimeout(r, 20));
  const message = ctx.mail.slice(before).find((m) => m.to === email);
  if (!message) throw new Error('no magic link email captured');
  const link = new URL(/https?:\/\/\S+/.exec(message.text)![0]);
  const verify = await ctx.app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
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
