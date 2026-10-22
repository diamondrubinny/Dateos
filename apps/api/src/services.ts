import { createDb, type DbHandle } from '@nexaheart/db';
import { createStorage, type Storage } from '@nexaheart/storage';
import type { Redis } from 'ioredis';
import { createAuth, type Auth } from './auth/auth.js';
import { requireServiceEnv, type Env } from './config/env.js';
import type { Dependency } from './lib/dependencies.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import {
  createMediaQueue,
  createNotifyQueue,
  createProfileQueue,
  type MediaQueue,
  type NotifyQueue,
  type ProfileQueue,
} from './lib/queue.js';
import { AudioService } from './modules/chat/audio.js';
import { llmIcebreakers, templateIcebreakers, type TextModel } from '@nexaheart/ai';
import { AiGate, createTextModel } from './lib/ai-gate.js';
import { createRealtime, type Realtime } from './lib/realtime.js';
import { ChatService } from './modules/chat/service.js';
import { DiscoveryService } from './modules/discovery/service.js';
import { MeService, todayUtc } from './modules/me/service.js';
import { PhotoService } from './modules/photos/service.js';
import { createEmailHasher } from './lib/banned.js';
import { StaffMfaService } from './modules/admin/mfa.js';
import { ModerationService } from './modules/admin/moderation.js';
import { ReportService } from './modules/safety/reports.js';
import { InstanceService } from './modules/instance/service.js';
import { VerificationService } from './modules/safety/verification.js';
import { CheckinService } from './modules/checkins/service.js';
import { DateService } from './modules/dates/service.js';
import { VenueService } from './modules/dates/venues.js';
import { EventService } from './modules/events/service.js';
import { CallService } from './modules/calls/service.js';
import { createLiveKitMedia, type CallMedia } from './lib/livekit.js';

export interface Services {
  dbHandle: DbHandle;
  redis: Redis;
  auth: Auth;
  storage: Storage;
  mediaQueue: MediaQueue;
  profileQueue: ProfileQueue;
  notifyQueue: NotifyQueue;
  audio: AudioService;
  discovery: DiscoveryService;
  realtime: Realtime;
  chat: ChatService;
  mailer: Mailer;
  me: MeService;
  photos: PhotoService;
  reports: ReportService;
  verification: VerificationService;
  staffMfa: StaffMfaService;
  moderation: ModerationService;
  instance: InstanceService;
  checkins: CheckinService;
  venues: VenueService;
  dates: DateService;
  events: EventService;
  calls: CallService;
  ai: AiGate;
  /** Health checks and shutdown hooks for the resources above. */
  dependencies: Dependency[];
}

export interface ServiceOverrides {
  mailer?: Mailer;
  mediaQueue?: MediaQueue;
  profileQueue?: ProfileQueue;
  notifyQueue?: NotifyQueue;
  today?: () => string;
  /** Text AI model (tests use a fake; null = no AI). */
  textModel?: TextModel | null;
  /** Clock for TOTP checks (tests). */
  now?: () => number;
  /** Media server for calls (tests use a fake; null = calls unavailable). */
  callMedia?: CallMedia | null;
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
  const notifyQueue = overrides.notifyQueue ?? createNotifyQueue(env.REDIS_URL);
  const realtime = createRealtime(env.REDIS_URL);
  const discovery = new DiscoveryService(dbHandle.db, today, realtime, (userId, matchId) =>
    notifyQueue.push({ userId, kind: 'match', matchId }),
  );
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
  const ai = new AiGate(
    dbHandle.db,
    overrides.textModel !== undefined ? overrides.textModel : createTextModel(env),
  );
  const icebreakers = async (a: string, b: string) => {
    const model = await ai.modelFor(a, b);
    return model ? llmIcebreakers(model) : templateIcebreakers;
  };

  const verification = new VerificationService(dbHandle.db, photos);
  const instance = new InstanceService(dbHandle.db, env, photos);
  const audio = new AudioService(dbHandle.db, storage, mediaQueue);
  const hashEmail = createEmailHasher(secrets.authSecret);
  const venues = new VenueService(dbHandle.db);
  const chat = new ChatService(dbHandle.db, realtime, discovery, photos, icebreakers, audio, {
    messageReceived: (userId, matchId) => notifyQueue.push({ userId, kind: 'message', matchId }),
  });

  const calls = new CallService(
    dbHandle.db,
    chat,
    realtime,
    overrides.callMedia !== undefined ? overrides.callMedia : createLiveKitMedia(env),
    () => instance.callSettings(),
    (userId, matchId) => notifyQueue.push({ userId, kind: 'call', matchId }),
    overrides.now,
  );
  chat.setCallAvailability((matchId, viewerId, otherId) =>
    calls.available(matchId, viewerId, otherId),
  );
  discovery.onMatchClosed((matchId) => calls.endForMatch(matchId));

  return {
    dbHandle,
    redis,
    auth,
    storage,
    mediaQueue,
    profileQueue,
    notifyQueue,
    audio,
    discovery,
    mailer,
    me: new MeService(dbHandle.db, mediaQueue, legal, today, profileQueue),
    photos,
    realtime,
    chat,
    venues,
    dates: new DateService(dbHandle.db, chat, venues, overrides.now),
    calls,
    events: new EventService(
      dbHandle.db,
      (userId, eventId) => notifyQueue.push({ userId, kind: 'event', matchId: eventId }),
      overrides.now,
    ),
    reports: new ReportService(
      dbHandle.db,
      discovery,
      mailer,
      env.INSTANCE_NAME,
      onMailError,
      storage,
    ),
    verification,
    staffMfa: new StaffMfaService(
      dbHandle.db,
      secrets.authSecret,
      env.INSTANCE_NAME,
      overrides.now,
    ),
    moderation: new ModerationService(dbHandle.db, discovery, hashEmail, today),
    instance,
    checkins: new CheckinService(
      dbHandle.db,
      mailer,
      async () => (await instance.info()).name,
      onMailError,
    ),
    ai,
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
      { name: 'notify-queue', isHealthy: async () => true, close: () => notifyQueue.close() },
      { name: 'mailer', isHealthy: async () => true, close: async () => mailer.close() },
    ],
  };
}
