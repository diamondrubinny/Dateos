// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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
  /** Integrations (phase 24): the same key as the API's, to read secrets saved in the dashboard. */
  INTEGRATIONS_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** The dashboard's address, for links in team alerts. */
  PUBLIC_ADMIN_URL: z
    .string()
    .optional()
    .transform((v) => v ?? ''),
  INTEGRATIONS_ALLOW_PRIVATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Voice transcripts (phase 26): `local` runs an open speech model on this server; `off` hides them. */
  TRANSCRIPTS: z.enum(['local', 'off']).default('local'),
  /** A Whisper model in ONNX format; `onnx-community/whisper-small` is better for Hebrew and Arabic. */
  TRANSCRIPTS_MODEL: z.string().min(1).default('onnx-community/whisper-base'),
  /** Where the model is kept (downloaded once from Hugging Face, or copied there by hand). */
  TRANSCRIPTS_CACHE: z.string().min(1).default('./.cache/models'),
  /** Months without sign-in before an account is warned and then deleted. 0 = never (default). ⚖️ */
  INACTIVE_ACCOUNT_DELETE_MONTHS: z.coerce.number().int().min(0).max(120).default(0),
  INSTANCE_NAME: z.string().max(40).default('NexaHeart'),
  // Updates from GitHub (phase 53). The commit is baked into the image at build time.
  APP_COMMIT: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  UPDATE_CHECK: z.enum(['on', 'off']).default('on'),
  UPDATE_REPO: z
    .string()
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/)
    .default('diamondrubinny/NexaHeart'),
  UPDATE_BRANCH: z
    .string()
    .regex(/^[A-Za-z0-9._/-]{1,100}$/)
    .default('main'),
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
  /** Video dates (phase 15): how the worker reaches LiveKit's API to end calls (optional). */
  LIVEKIT_URL: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  LIVEKIT_API_URL: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  LIVEKIT_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  LIVEKIT_API_SECRET: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
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
