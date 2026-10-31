// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createDb, type DbHandle } from '@nexaheart/db';
import type { RealtimeEvent } from '@nexaheart/shared';
import { createStorage, type Storage } from '@nexaheart/storage';
import type { Redis } from 'ioredis';
import { createAuth, type Auth } from './auth/auth.js';
import { appUrl, requireServiceEnv, type Env } from './config/env.js';
import type { Dependency } from './lib/dependencies.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { IntegrationStore, parseIntegrationsKey } from '@nexaheart/integrations';
import { IntegrationService } from './modules/integrations/service.js';
import { forwardToIntegrations } from './modules/integrations/forward.js';
import { AppEvents } from './lib/app-events.js';
import {
  createMediaQueue,
  createNotifyQueue,
  createOutboundQueue,
  createTranscribeQueue,
  createProfileQueue,
  type MediaQueue,
  type NotifyQueue,
  type OutboundQueue,
  type TranscribeQueue,
  type ProfileQueue,
} from './lib/queue.js';
import { AudioService } from './modules/chat/audio.js';
import { FederatedChat } from './modules/federation/chat.js';
import { FederatedMembers } from './modules/federation/members.js';
import { FederatedSafety } from './modules/federation/safety.js';
import { FederationService } from './modules/federation/service.js';
import { llmIcebreakers, templateIcebreakers, type TextModel } from '@nexaheart/ai';
import { AiGate } from './lib/ai-gate.js';
import { createRealtime, type Realtime } from './lib/realtime.js';
import { ChatService } from './modules/chat/service.js';
import { DiscoveryService } from './modules/discovery/service.js';
import { MeService, todayUtc } from './modules/me/service.js';
import { SpeedService } from './modules/speed/service.js';
import { MeetAgainService } from './modules/events/meet-again.js';
import { TableService } from './modules/events/tables.js';
import { PhotoService } from './modules/photos/service.js';
import { createEmailHasher } from './lib/banned.js';
import { EmailChangeService } from './modules/account/email-change.js';
import { StaffMfaService } from './modules/admin/mfa.js';
import { ModerationService } from './modules/admin/moderation.js';
import { AppealService } from './modules/safety/appeals.js';
import { AlbumService } from './modules/photos/album.js';
import { IntroductionService } from './modules/introductions/service.js';
import { ResumeService } from './modules/resume/service.js';
import { ProfileReviewService } from './modules/admin/review.js';
import { ChaperoneService } from './modules/chaperone/service.js';
import { LivenessService } from './modules/liveness/service.js';
import { ComplianceService } from './modules/compliance/service.js';
import { AgeCheckService } from './modules/age-check/service.js';
import { ReportService } from './modules/safety/reports.js';
import { InstanceService } from './modules/instance/service.js';
import { VerificationService } from './modules/safety/verification.js';
import { CheckinService } from './modules/checkins/service.js';
import { DateService } from './modules/dates/service.js';
import { VenueService } from './modules/dates/venues.js';
import { EventService } from './modules/events/service.js';
import { CityIndex } from './modules/places/cities.js';
import { TravelService } from './modules/places/service.js';
import { CallService } from './modules/calls/service.js';
import { PairService } from './modules/friends/pairs.js';
import { TakeService } from './modules/friends/takes.js';
import { TrustService } from './modules/trust/service.js';
import { UpdateService } from './modules/updates/service.js';
import type { CallMedia } from './lib/livekit.js';

export interface Services {
  dbHandle: DbHandle;
  redis: Redis;
  auth: Auth;
  storage: Storage;
  mediaQueue: MediaQueue;
  profileQueue: ProfileQueue;
  notifyQueue: NotifyQueue;
  audio: AudioService;
  federation: FederationService;
  federated: FederatedMembers;
  federatedChat: FederatedChat;
  federatedSafety: FederatedSafety;
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
  appeals: AppealService;
  /** Phase 64. */
  compliance: ComplianceService;
  /** Phase 66c. */
  album: AlbumService;
  introductions: IntroductionService;
  resume: ResumeService;
  profileReview: ProfileReviewService;
  chaperones: ChaperoneService;
  liveness: LivenessService;
  ageCheck: AgeCheckService;
  updates: UpdateService;
  trust: TrustService;
  takes: TakeService;
  pairs: PairService;
  instance: InstanceService;
  checkins: CheckinService;
  venues: VenueService;
  dates: DateService;
  events: EventService;
  cities: CityIndex;
  travel: TravelService;
  calls: CallService;
  speed: SpeedService;
  meetAgain: MeetAgainService;
  tables: TableService;
  ai: AiGate;
  integrations: IntegrationService;
  outboundQueue: OutboundQueue;
  emailChange: EmailChangeService;
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
  /** Integrations (phase 24): what counts as "set by the server", the key, and the network. */
  integrationsEnv?: Record<string, string | undefined>;
  integrationsKey?: Buffer | null;
  outboundQueue?: OutboundQueue;
  /** Phase 26: voice transcripts; `null` turns them off (as `TRANSCRIPTS=off`). */
  transcribeQueue?: TranscribeQueue | null;
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
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
  const sealKey =
    overrides.integrationsKey !== undefined
      ? overrides.integrationsKey
      : parseIntegrationsKey(env.INTEGRATIONS_KEY);
  const integrationStore = new IntegrationStore(
    dbHandle.db,
    sealKey,
    overrides.integrationsEnv ?? process.env,
  );
  const outboundQueue = overrides.outboundQueue ?? createOutboundQueue(env.REDIS_URL);
  const integrations = new IntegrationService(
    dbHandle.db,
    integrationStore,
    {
      env,
      outbound: outboundQueue,
      storage,
      ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
      ...(overrides.resolve ? { resolve: overrides.resolve } : {}),
      ...(overrides.textModel !== undefined ? { textModel: overrides.textModel } : {}),
      ...(overrides.callMedia !== undefined ? { callMedia: overrides.callMedia } : {}),
    },
    overrides.now,
  );
  const mailer = overrides.mailer ?? createMailer(env, () => integrations.dashboardMail());
  const mediaQueue = overrides.mediaQueue ?? createMediaQueue(env.REDIS_URL);
  const profileQueue = overrides.profileQueue ?? createProfileQueue(env.REDIS_URL);
  const today = overrides.today ?? todayUtc;
  const notifyQueue = overrides.notifyQueue ?? createNotifyQueue(env.REDIS_URL);
  const realtime = createRealtime(env.REDIS_URL);
  const cities = CityIndex.load();
  const discovery = new DiscoveryService(
    dbHandle.db,
    today,
    realtime,
    (userId, matchId) => notifyQueue.push({ userId, kind: 'match', matchId }),
    cities,
  );
  const legal = { termsVersion: env.TERMS_VERSION, privacyVersion: env.PRIVACY_VERSION };
  const photos = new PhotoService(dbHandle.db, storage, mediaQueue, (viewer, owner) =>
    discovery.canView(viewer, owner),
  );
  const ai = new AiGate(dbHandle.db, () => integrations.aiModel());
  const icebreakers = async (a: string, b: string) => {
    const model = await ai.modelFor(a, b);
    return model ? llmIcebreakers(model) : templateIcebreakers;
  };

  const verification = new VerificationService(dbHandle.db, photos);
  const instance = new InstanceService(dbHandle.db, env, photos);
  const audio = new AudioService(dbHandle.db, storage, mediaQueue);
  audio.useVisibility((viewerId, ownerId) => discovery.canView(viewerId, ownerId));
  const transcribeQueue =
    overrides.transcribeQueue !== undefined
      ? overrides.transcribeQueue
      : env.TRANSCRIPTS === 'local'
        ? createTranscribeQueue(env.REDIS_URL)
        : null;
  if (transcribeQueue) audio.useTranscripts(transcribeQueue);
  const hashEmail = createEmailHasher(secrets.authSecret);
  const trust = new TrustService(
    dbHandle.db,
    env,
    instance,
    mailer,
    createEmailHasher(secrets.authSecret, 'signup-email'),
    onMailError,
    overrides.now,
  );
  const auth = createAuth({
    env,
    secret: secrets.authSecret,
    db: dbHandle.db,
    redis,
    mailer,
    onMailError,
    signup: trust,
  });
  const venues = new VenueService(dbHandle.db);
  // Friends (phase 22).
  const takes = new TakeService(dbHandle.db, overrides.now);
  const pairs = new PairService(
    dbHandle.db,
    discovery,
    (userId, event) => realtime.publish(userId, event),
    today,
    overrides.now,
  );
  discovery.onSeparation((a, b) => (b ? pairs.closeForBlock(a, b) : pairs.closeForUser(a)));
  const chat = new ChatService(
    dbHandle.db,
    realtime,
    discovery,
    photos,
    icebreakers,
    audio,
    {
      messageReceived: (userId, matchId) => notifyQueue.push({ userId, kind: 'message', matchId }),
    },
    overrides.now,
  );
  // Phase 66c: private albums, shared in chats.
  const album = new AlbumService(dbHandle.db, photos);
  chat.useAlbum(album);
  // Phase 68d: chaperones, with a notice both sides of a chat see.
  const chaperones = new ChaperoneService(dbHandle.db, overrides.now);
  chat.useChaperones(chaperones);
  // Phase 68b: the matchmaking résumé, shared by short-lived links.
  const resume = new ResumeService(dbHandle.db, {
    ownCard: (userId) => discovery.ownCard(userId),
    openPhoto: (photoId, ownerId) => photos.openForStaff(photoId, 'profile', ownerId),
    communityName: async () => (await instance.info()).name,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  // Phase 68a: introductions by community matchmakers.
  const introductions = new IntroductionService(dbHandle.db, {
    isCandidate: (a, b) => discovery.isCandidate(a, b),
    match: (a, b) => discovery.matchFromSpeedDate(a, b),
    order: () => instance.introductionOrder(),
    notify: (userId, id) => {
      notifyQueue.push({ userId, kind: 'introduction', matchId: id }).catch(() => undefined);
    },
  });

  const callMedia = () => integrations.media();
  const calls = new CallService(
    dbHandle.db,
    chat,
    realtime,
    callMedia,
    () => instance.callSettings(),
    (userId, matchId) => notifyQueue.push({ userId, kind: 'call', matchId }),
    overrides.now,
  );
  chat.setCallAvailability((matchId, viewerId, otherId) =>
    calls.available(matchId, viewerId, otherId),
  );
  discovery.onMatchClosed((matchId) => calls.endForMatch(matchId));
  const speed = new SpeedService(
    dbHandle.db,
    discovery,
    callMedia,
    async () => (await calls.enabled()) !== null,
    today,
    overrides.now,
  );
  discovery.onSeparation((a, b) => (b ? speed.closeForBlock(a, b) : speed.closeForUser(a)));

  // Communities that connect (phase 28a).
  const federation = new FederationService(
    dbHandle.db,
    redis,
    {
      on: env.FEDERATION === 'on',
      sealKey,
      apiUrl: env.PUBLIC_API_URL,
      appUrl: appUrl(env),
      instance: async () => {
        const info = await instance.info();
        return { name: info.name, contactEmail: info.contactEmail };
      },
      outbound: {
        allowPrivate: env.INTEGRATIONS_ALLOW_PRIVATE,
        ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
        ...(overrides.resolve ? { resolve: overrides.resolve } : {}),
      },
    },
    overrides.now,
  );
  // 28b: partners' members, and ours at partners.
  const federated = new FederatedMembers(dbHandle.db, federation, storage, today);
  const publish = (userId: string, event: RealtimeEvent) =>
    void realtime.publish(userId, event).catch(() => undefined);
  federated.useRealtime(publish);
  // 28c: chat across communities.
  const federatedChat = new FederatedChat(dbHandle.db, federation, federated, {
    publish,
    pushMessage: (userId, matchId) =>
      notifyQueue.push({ userId, kind: 'partner_message', matchId }),
  });
  discovery.onSeparation((a, b) => (b ? Promise.resolve() : federated.endAllMatches(a)));
  const me = new MeService(dbHandle.db, mediaQueue, legal, today, profileQueue);
  // 28d: reports across communities, and their outcomes.
  const reports = new ReportService(
    dbHandle.db,
    discovery,
    mailer,
    env.INSTANCE_NAME,
    onMailError,
    storage,
  );
  const moderation = new ModerationService(dbHandle.db, discovery, hashEmail, today);
  const appeals = new AppealService(dbHandle.db, mailer, env.INSTANCE_NAME, onMailError);
  // Phase 63: age assurance through the community's provider, when one is configured.
  const ageCheck = new AgeCheckService(
    dbHandle.db,
    env.AGE_CHECK_URL && env.AGE_CHECK_SECRET
      ? { url: env.AGE_CHECK_URL, secret: env.AGE_CHECK_SECRET }
      : undefined,
    { api: env.PUBLIC_API_URL.replace(/\/+$/, ''), app: appUrl(env) },
    overrides.now,
  );
  // Phase 69: a live check through the community's provider, and asking a match to verify.
  const liveness = new LivenessService(
    dbHandle.db,
    env.LIVENESS_URL && env.LIVENESS_SECRET
      ? { url: env.LIVENESS_URL, secret: env.LIVENESS_SECRET }
      : undefined,
    { api: env.PUBLIC_API_URL.replace(/\/+$/, ''), app: appUrl(env) },
    (photoId, ownerId) => photos.openForStaff(photoId, 'profile', ownerId),
    overrides.now,
  );
  chat.useVerifyRequests(liveness);
  const compliance = new ComplianceService(
    dbHandle.db,
    {
      instanceName: env.INSTANCE_NAME,
      ageCheckProvider: Boolean(env.AGE_CHECK_URL && env.AGE_CHECK_SECRET),
      externalAi: env.ICEBREAKERS_PROVIDER === 'openai' && env.OPENAI_EXTERNAL,
      videoCalls: Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
    },
    overrides.now,
  );
  me.useAgeCheck(async (userId) => (await ageCheck.required()) && !(await ageCheck.passed(userId)));
  const updates = new UpdateService(
    dbHandle.db,
    {
      enabled: env.UPDATE_CHECK === 'on',
      repo: env.UPDATE_REPO,
      branch: env.UPDATE_BRANCH,
      current: env.APP_COMMIT,
    },
    env.UPDATE_EMAILS === 'on',
  );
  const federatedSafety = new FederatedSafety(dbHandle.db, federation, federated, () =>
    reports.alertStaff(),
  );
  moderation.usePartnerOutcomes((settled) => federatedSafety.sendOutcomes(settled));
  me.beforeDelete((userId) => federated.forgetEverywhere(userId));

  const services: Services = {
    dbHandle,
    redis,
    auth,
    storage,
    mediaQueue,
    profileQueue,
    notifyQueue,
    audio,
    federation,
    federated,
    federatedChat,
    federatedSafety,
    discovery,
    mailer,
    me,
    photos,
    realtime,
    chat,
    venues,
    dates: new DateService(dbHandle.db, chat, venues, overrides.now),
    calls,
    speed,
    integrations,
    outboundQueue,
    emailChange: new EmailChangeService(dbHandle.db, mailer, hashEmail, {
      instanceName: env.INSTANCE_NAME,
      appUrl: appUrl(env),
      onMailError,
      ...(overrides.now ? { now: overrides.now } : {}),
    }),
    cities,
    travel: new TravelService(dbHandle.db, cities),
    meetAgain: new MeetAgainService(dbHandle.db, discovery, overrides.now),
    tables: new TableService(dbHandle.db, overrides.now),
    events: new EventService(
      dbHandle.db,
      (userId, eventId) => notifyQueue.push({ userId, kind: 'event', matchId: eventId }),
      overrides.now,
      {
        appUrl: appUrl(env),
        speedAvailable: async () => (await calls.enabled()) !== null,
        helpPush: (adminId, eventId) =>
          notifyQueue.push({ userId: adminId, kind: 'event_help', matchId: eventId }),
      },
    ),
    reports,
    verification,
    staffMfa: new StaffMfaService(
      dbHandle.db,
      secrets.authSecret,
      env.INSTANCE_NAME,
      overrides.now,
    ),
    moderation,
    appeals,
    compliance,
    album,
    introductions,
    resume,
    profileReview: new ProfileReviewService(dbHandle.db),
    chaperones,
    liveness,
    ageCheck,
    updates,
    instance,
    trust,
    takes,
    pairs,
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
      { name: 'outbound-queue', isHealthy: async () => true, close: () => outboundQueue.close() },
      {
        name: 'transcribe-queue',
        isHealthy: async () => true,
        close: async () => transcribeQueue?.close(),
      },
      { name: 'mailer', isHealthy: async () => true, close: async () => mailer.close() },
    ],
  };

  // Integrations (phase 24): what happened, turned into webhooks and team alerts.
  const appEvents = new AppEvents();
  for (const service of [
    services.reports,
    services.moderation,
    services.trust,
    services.me,
    services.discovery,
    services.events,
  ]) {
    service.appEvents = appEvents;
  }
  appEvents.on((event) => forwardToIntegrations(event, integrations, dbHandle.db));
  return services;
}
