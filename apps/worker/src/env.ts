import { z } from 'zod';

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  S3_ENDPOINT: z.url().default('http://localhost:8333'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_QUARANTINE: z.string().default('nexaheart-quarantine'),
  S3_BUCKET_MEDIA: z.string().default('nexaheart-media'),
  /** `disabled` is "Lite mode" for tiny servers: every job logs a warning. */
  MALWARE_SCAN: z.enum(['clamav', 'disabled']).default('clamav'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  /** `hashing` works offline with no model; `ollama` uses a local semantic model. */
  EMBEDDINGS_PROVIDER: z.enum(['hashing', 'ollama']).default('hashing'),
  OLLAMA_URL: z.url().default('http://localhost:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('paraphrase-multilingual'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  /** Push notifications through Expo (opt-in per device). `disabled` sends nothing. */
  PUSH_PROVIDER: z.enum(['disabled', 'expo']).default('disabled'),
  EXPO_PUSH_URL: z.url().default('https://exp.host/--/api/v2/push/send'),
  EXPO_ACCESS_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Months without sign-in before an account is warned and then deleted. 0 = never (default). ⚖️ */
  INACTIVE_ACCOUNT_DELETE_MONTHS: z.coerce.number().int().min(0).max(120).default(0),
  INSTANCE_NAME: z.string().max(40).default('NexaHeart'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  SMTP_PASSWORD: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  SMTP_FROM: z.string().default('NexaHeart <no-reply@localhost>'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    // Key names only: values may be secrets.
    throw new Error(`Invalid or missing environment variables: ${keys.join(', ')}`);
  }
  return result.data;
}
