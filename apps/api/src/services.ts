import { createDb, type DbHandle } from '@dateos/db';
import { createStorage, type Storage } from '@dateos/storage';
import type { Redis } from 'ioredis';
import { createAuth, type Auth } from './auth/auth.js';
import { requireServiceEnv, type Env } from './config/env.js';
import type { Dependency } from './lib/dependencies.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import {
  createMediaQueue,
  createProfileQueue,
  type MediaQueue,
  type ProfileQueue,
} from './lib/queue.js';
import { ollamaIcebreakers, templateIcebreakers } from '@dateos/ai';
import { createRealtime, type Realtime } from './lib/realtime.js';
import { ChatService } from './modules/chat/service.js';
import { DiscoveryService } from './modules/discovery/service.js';
import { MeService, todayUtc } from './modules/me/service.js';
import { PhotoService } from './modules/photos/service.js';

export interface Services {
  dbHandle: DbHandle;
  auth: Auth;
  storage: Storage;
  mediaQueue: MediaQueue;
  profileQueue: ProfileQueue;
  discovery: DiscoveryService;
  realtime: Realtime;
  chat: ChatService;
  mailer: Mailer;
  me: MeService;
  photos: PhotoService;
  /** Health checks and shutdown hooks for the resources above. */
  dependencies: Dependency[];
}

export interface ServiceOverrides {
  mailer?: Mailer;
  mediaQueue?: MediaQueue;
  profileQueue?: ProfileQueue;
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
  const profileQueue = overrides.profileQueue ?? createProfileQueue(env.REDIS_URL);
  const today = overrides.today ?? todayUtc;
  const realtime = createRealtime(env.REDIS_URL);
  const discovery = new DiscoveryService(dbHandle.db, today, realtime);
  const auth = createAuth({
    env,
    secret: secrets.authSecret,
    db: dbHandle.db,
    redis,
    mailer,
    onMailError,
  });
  const legal = { termsVersion: env.TERMS_VERSION, privacyVersion: env.PRIVACY_VERSION };
  const photos = new PhotoService(dbHandle.db, storage, mediaQueue, (viewer, owner) =>
    discovery.canView(viewer, owner),
  );
  const icebreakers =
    env.ICEBREAKERS_PROVIDER === 'ollama'
      ? ollamaIcebreakers(env.OLLAMA_URL, env.OLLAMA_CHAT_MODEL)
      : templateIcebreakers;

  return {
    dbHandle,
    auth,
    storage,
    mediaQueue,
    profileQueue,
    discovery,
    mailer,
    me: new MeService(dbHandle.db, mediaQueue, legal, today, profileQueue),
    photos,
    realtime,
    chat: new ChatService(dbHandle.db, realtime, discovery, photos, icebreakers),
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
      { name: 'realtime', isHealthy: async () => true, close: () => realtime.close() },
      { name: 'profile-queue', isHealthy: async () => true, close: () => profileQueue.close() },
      { name: 'mailer', isHealthy: async () => true, close: async () => mailer.close() },
    ],
  };
}
