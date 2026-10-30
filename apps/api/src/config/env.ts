// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { DEFAULT_TAGLINE, localeSchema, UPSTREAM_SOURCE_URL } from '@nexaheart/shared';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const csvList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  /** Comma-separated list of allowed browser origins. Empty means no cross-origin access. */
  CORS_ORIGINS: csvList.default([]),
  /**
   * Whose X-Forwarded-For to believe. `false` (default): nobody. `true`: a proxy on this host or a
   * private network (Caddy in docker-compose). Or a list of IPs/CIDRs. Never "every hop": a client
   * could then forge its address and slip past rate limits behind a proxy that appends the header.
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v): false | string[] =>
      v === 'false' || v === ''
        ? false
        : v === 'true'
          ? ['loopback', 'uniquelocal']
          : v
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean),
    ),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().max(10_485_760).default(65_536),

  /** Applies pending DB migrations at startup. Disable when running several API replicas. */
  MIGRATE_ON_START: booleanString.default(true),

  /** Public URL of this API, used in sign-in links. Must be https in production. */
  PUBLIC_API_URL: z.url().default('http://localhost:4000'),
  /**
   * Public URL of the web app (phase 21): links in emails, and the passkey origin and domain.
   * Defaults to the first CORS origin.
   */
  PUBLIC_APP_URL: optionalString.pipe(z.url().optional()),
  /** WebSocket ping interval; each ping also re-checks the session (sign-out, suspension). */
  WS_HEARTBEAT_MS: z.coerce.number().int().min(100).max(120_000).default(30_000),
  /** Deep-link scheme of the native app (nexaheart://...). */
  APP_SCHEME: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*$/)
    .default('nexaheart'),
  AUTH_SECRET: z.string().min(32).optional(),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: z.string().default('NexaHeart <no-reply@localhost>'),

  S3_ENDPOINT: z.url().default('http://localhost:8333'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_BUCKET_QUARANTINE: z.string().default('nexaheart-quarantine'),
  S3_BUCKET_MEDIA: z.string().default('nexaheart-media'),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  APPLE_CLIENT_ID: optionalString,
  APPLE_CLIENT_SECRET: optionalString,

  /** `template` works offline; `ollama` uses a local chat model (no data leaves the server). */
  /**
   * Text AI for icebreakers and bio ideas: `template` (no AI), `ollama` (on this server) or
   * `openai` (any OpenAI-compatible endpoint, see OPENAI_*).
   */
  ICEBREAKERS_PROVIDER: z.enum(['template', 'ollama', 'openai']).default('template'),
  OLLAMA_URL: z.url().default('http://localhost:11434'),
  OLLAMA_CHAT_MODEL: z.string().default('qwen2.5:1.5b'),
  OPENAI_BASE_URL: optionalString.pipe(z.url().optional()),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  /** true when the endpoint is a third party (members must opt in to `ai_cloud`). */
  OPENAI_EXTERNAL: booleanString.default(true),

  INSTANCE_NAME: z.string().max(40).default('NexaHeart'),
  /**
   * Phase 60: the server's Web Push public key (VAPID, base64url, made by the install command).
   * Empty: no notifications in the web app. The private key is the worker's only.
   */
  WEB_PUSH_PUBLIC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{86,88}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Updates from GitHub (phase 53). The commit is baked into the image at build time.
  APP_COMMIT: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  UPDATE_CHECK: z.enum(['on', 'off']).default('on'),
  /** Phase 54: email the admins when an update is available and when one finishes. */
  UPDATE_EMAILS: z.enum(['on', 'off']).default('on'),
  UPDATE_REPO: z
    .string()
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/)
    .default('diamondrubinny/NexaHeart'),
  UPDATE_BRANCH: z
    .string()
    .regex(/^[A-Za-z0-9._/-]{1,100}$/)
    .default('main'),
  /** Where the app's "Open source" link points. A modified version must point to its own source. */
  SOURCE_CODE_URL: z.url().default(UPSTREAM_SOURCE_URL),
  INSTANCE_TAGLINE: z.string().max(120).default(DEFAULT_TAGLINE),
  INSTANCE_PRIMARY_COLOR: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#7C3AED'),
  INSTANCE_LOCALES: csvList.default(['he', 'en', 'ar', 'ru']),
  INSTANCE_DEFAULT_LOCALE: localeSchema.default('he'),
  SPONSOR_URL: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * One-time token to claim a fresh instance from the dashboard (install.sh generates it).
   * Leave empty to allow only the server-side staff command.
   */
  SETUP_TOKEN: z
    .string()
    .min(24)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Video dates (phase 15), off unless all three are set. LIVEKIT_URL is the public address apps
   * connect to (wss://rtc.example.org); LIVEKIT_API_URL is how this server reaches LiveKit's API
   * (defaults to LIVEKIT_URL over https). The key and secret are generated by install.sh.
   */
  /** Communities that connect (phase 28): off until an admin of this server decides. ⚖️ */
  FEDERATION: z.enum(['on', 'off']).default('off'),
  /** Voice transcripts (phase 26): `local` = an open speech model in the worker; `off` hides them. */
  TRANSCRIPTS: z.enum(['local', 'off']).default('local'),
  LIVEKIT_URL: optionalString.pipe(z.url({ protocol: /^wss?$/ }).optional()),
  LIVEKIT_API_URL: optionalString.pipe(z.url({ protocol: /^https?$/ }).optional()),
  LIVEKIT_API_KEY: optionalString,
  LIVEKIT_API_SECRET: optionalString.pipe(z.string().min(32).optional()),
  /**
   * Integrations (phase 24): 32 random bytes (hex or base64) that encrypt the secrets saved in the
   * dashboard. Without it the Integrations page is read-only. install.sh generates it.
   */
  INTEGRATIONS_KEY: optionalString,
  /** The dashboard's address, for links in team alerts. Defaults to admin.<the app's domain>. */
  PUBLIC_ADMIN_URL: optionalString.pipe(z.url().optional()),
  /** Lets integrations reach hosts on this server's own network (Ollama, a self-hosted Matomo). */
  INTEGRATIONS_ALLOW_PRIVATE: booleanString.default(false),
  /** Set any of these to manage the integration here instead of in the dashboard (env wins). */
  CAPTCHA_PROVIDER: optionalString,
  CAPTCHA_SITE_KEY: optionalString,
  CAPTCHA_SECRET_KEY: optionalString,
  SENTRY_DSN: optionalString,
  SENTRY_ENVIRONMENT: optionalString,
  ANALYTICS_PROVIDER: optionalString,
  ANALYTICS_URL: optionalString,
  ANALYTICS_SITE_ID: optionalString,
  TERMS_VERSION: z.string().max(32).default('2026-10'),
  PRIVACY_VERSION: z.string().max(32).default('2026-10'),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly invalidKeys: string[]) {
    // Only key names are reported, never values, so secrets cannot leak into logs.
    super(`Invalid or missing environment variables: ${invalidKeys.join(', ')}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new EnvValidationError(keys);
  }
  const env = result.data;
  const invalid: string[] = [];
  if (env.NODE_ENV === 'production') {
    if (env.CORS_ORIGINS.includes('*')) invalid.push('CORS_ORIGINS');
    if (!env.PUBLIC_API_URL.startsWith('https://')) invalid.push('PUBLIC_API_URL');
    if (!env.AUTH_SECRET) invalid.push('AUTH_SECRET');
    if (env.LIVEKIT_URL && !env.LIVEKIT_URL.startsWith('wss://')) invalid.push('LIVEKIT_URL');
  }
  if (invalid.length > 0) throw new EnvValidationError(invalid);
  return env;
}

/** Product services (auth, storage, ...) need these; health-only setups do not. */
export function requireServiceEnv(env: Env) {
  const missing = (['AUTH_SECRET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter(
    (key) => !env[key],
  );
  if (missing.length > 0) throw new EnvValidationError([...missing]);
  return {
    authSecret: env.AUTH_SECRET!,
    s3AccessKeyId: env.S3_ACCESS_KEY_ID!,
    s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY!,
  };
}

/** The web app's public URL (no trailing slash): PUBLIC_APP_URL, else the first CORS origin. */
export function appUrl(env: Env): string {
  return (env.PUBLIC_APP_URL ?? env.CORS_ORIGINS[0] ?? 'http://localhost:8081').replace(/\/+$/, '');
}
