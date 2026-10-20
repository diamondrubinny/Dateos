import { createDb, type DbHandle } from '@dateos/db';
import { createStorage, type Storage } from '@dateos/storage';
import type { Redis } from 'ioredis';
import { createAuth, type Auth } from './auth/auth.js';
import { requireServiceEnv, type Env } from './config/env.js';
import type { Dependency } from './lib/dependencies.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { createMediaQueue, type MediaQueue } from './lib/queue.js';
import { MeService } from './modules/me/service.js';
import { PhotoService } from './modules/photos/service.js';

export interface Services {
  dbHandle: DbHandle;
  auth: Auth;
  storage: Storage;
  mediaQueue: MediaQueue;
  mailer: Mailer;
  me: MeService;
  photos: PhotoService;
  /** Health checks and shutdown hooks for the resources above. */
  dependencies: Dependency[];
}

export interface ServiceOverrides {
  mailer?: Mailer;
  mediaQueue?: MediaQueue;
  today?: () => string;
}

export function createServices(
  env: Env,
  redis: Redis,
  onMailError: (error: unknown) => void,
  overrides: ServiceOverrides = {},
): Services {
  const secrets = requireServiceEnv(env);
  const dbHandle = createDb(env.DATABASE_URL);
  const storage = createStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: secrets.s3AccessKeyId,
    secretAccessKey: secrets.s3SecretAccessKey,
    quarantineBucket: env.S3_BUCKET_QUARANTINE,
    mediaBucket: env.S3_BUCKET_MEDIA,
  });
  const mailer = overrides.mailer ?? createMailer(env);
  const mediaQueue = overrides.mediaQueue ?? createMediaQueue(env.REDIS_URL);
  const auth = createAuth({
    env,
    secret: secrets.authSecret,
    db: dbHandle.db,
    redis,
    mailer,
    onMailError,
  });
  const legal = { termsVersion: env.TERMS_VERSION, privacyVersion: env.PRIVACY_VERSION };

  return {
    dbHandle,
    auth,
    storage,
    mediaQueue,
    mailer,
    me: new MeService(dbHandle.db, mediaQueue, legal, overrides.today),
    photos: new PhotoService(dbHandle.db, storage, mediaQueue),
    dependencies: [
      {
        name: 'postgres',
        isHealthy: async () => {
          try {
            await dbHandle.pool.query('SELECT 1');
            return true;
          } catch {
            return false;
          }
        },
        close: () => dbHandle.pool.end(),
      },
      { name: 'storage', isHealthy: () => storage.isHealthy(), close: async () => storage.close() },
      { name: 'queue', isHealthy: async () => true, close: () => mediaQueue.close() },
      { name: 'mailer', isHealthy: async () => true, close: async () => mailer.close() },
    ],
  };
}
