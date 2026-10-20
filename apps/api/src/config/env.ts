import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const csvList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

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
  if (result.data.NODE_ENV === 'production' && result.data.CORS_ORIGINS.includes('*')) {
    throw new EnvValidationError(['CORS_ORIGINS']);
  }
  return result.data;
}
