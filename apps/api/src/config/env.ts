import { DEFAULT_TAGLINE } from '@dateos/shared';
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
  /** Set to true only when running behind a reverse proxy you control (e.g. Caddy). */
  TRUST_PROXY: booleanString.default(false),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().max(10_485_760).default(65_536),

  /** Applies pending DB migrations at startup. Disable when running several API replicas. */
  MIGRATE_ON_START: booleanString.default(true),

  /** Public URL of this API, used in sign-in links. Must be https in production. */
  PUBLIC_API_URL: z.url().default('http://localhost:4000'),
  /** Deep-link scheme of the native app (dateos://...). */
  APP_SCHEME: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*$/)
    .default('dateos'),
  AUTH_SECRET: z.string().min(32).optional(),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: z.string().default('Dateos <no-reply@localhost>'),

  S3_ENDPOINT: z.url().default('http://localhost:8333'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_BUCKET_QUARANTINE: z.string().default('dateos-quarantine'),
  S3_BUCKET_MEDIA: z.string().default('dateos-media'),

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

  INSTANCE_NAME: z.string().max(40).default('Dateos'),
  INSTANCE_TAGLINE: z.string().max(120).default(DEFAULT_TAGLINE),
  INSTANCE_PRIMARY_COLOR: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#7C3AED'),
  INSTANCE_LOCALES: csvList.default(['he', 'en']),
  INSTANCE_DEFAULT_LOCALE: z.enum(['he', 'en']).default('he'),
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
