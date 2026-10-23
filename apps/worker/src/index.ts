// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createDb } from '@nexaheart/db';
import { hashingProvider, ollamaProvider } from '@nexaheart/ai';
import {
  MEDIA_QUEUE,
  MediaJob,
  NOTIFY_QUEUE,
  type PushJob,
  PROFILE_QUEUE,
  ProfileJob,
  realtimeChannel,
  type DeleteObjectsJob,
  type EmbedProfileJob,
  type ProcessAudioJob,
  type ProcessPhotoJob,
  creditLine,
  PAUSE_SWEEP_SECONDS,
} from '@nexaheart/shared';
import { createStorage } from '@nexaheart/storage';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createClamavScanner, noopScanner } from './clamav.js';
import { loadWorkerEnv } from './env.js';
import { deleteObjects, processAudio, processPhoto, type JobContext } from './jobs.js';
import { sendPush } from './push.js';
import { cleanupPrivacy, handleInactiveAccounts } from './privacy-jobs.js';
import { processCheckins } from './checkin-jobs.js';
import { processEvents } from './event-jobs.js';
import { processPauses } from './pause-jobs.js';
import { processTrips } from './travel-jobs.js';
import { processAvailability } from './availability-jobs.js';
import { processSignupRetention } from './signup-jobs.js';
import { processFriendRetention } from './friend-jobs.js';
import { processCalls } from './call-jobs.js';
import { RoomServiceClient } from 'livekit-server-sdk';
import nodemailer from 'nodemailer';
import { sql } from 'drizzle-orm';
import {
  cleanupDiscovery,
  cleanupModeration,
  embedProfile,
  purgeClosedChats,
} from './profile-jobs.js';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });
  const { db, pool } = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 1 });
  const storage = createStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    quarantineBucket: env.S3_BUCKET_QUARANTINE,
    mediaBucket: env.S3_BUCKET_MEDIA,
  });
  await storage.ensureBuckets();

  const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const pushContext = {
    db,
    redis: publisher,
    log,
    provider: env.PUSH_PROVIDER,
    expoUrl: env.EXPO_PUSH_URL,
    expoAccessToken: env.EXPO_ACCESS_TOKEN,
  };
  publisher.on('error', (error) => log.error({ err: error }, 'redis publisher error'));
  const scanningEnabled = env.MALWARE_SCAN === 'clamav';
  if (!scanningEnabled) log.warn('Lite mode: MALWARE_SCAN=disabled, uploads are NOT scanned');
  const ctx: JobContext = {
    db,
    storage,
    scanner: scanningEnabled ? createClamavScanner(env.CLAMAV_HOST, env.CLAMAV_PORT) : noopScanner,
    scanningEnabled,
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    log,
    publish: async (userId, event) => {
      await publisher.publish(realtimeChannel(userId), JSON.stringify(event));
    },
  };

  const mailer = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER && env.SMTP_PASSWORD
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
      : {}),
  });

  const liveKitApi = env.LIVEKIT_API_URL ?? env.LIVEKIT_URL?.replace(/^ws/, 'http') ?? undefined;
  const liveKitRooms =
    liveKitApi && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
      ? new RoomServiceClient(liveKitApi, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET)
      : null;

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker(
    MEDIA_QUEUE,
    async (job) => {
      switch (job.name) {
        case MediaJob.ProcessPhoto:
          return processPhoto(ctx, job.data as ProcessPhotoJob);
        case MediaJob.ProcessAudio:
          return processAudio(ctx, job.data as ProcessAudioJob);
        case MediaJob.DeleteObjects:
          return deleteObjects(ctx, job.data as DeleteObjectsJob);
        default:
          throw new Error(`Unknown job: ${job.name}`);
      }
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );
  worker.on('completed', (job, result) =>
    log.info({ job: job.name, id: job.id, result }, 'job done'),
  );
  worker.on('failed', (job, error) =>
    log.error({ job: job?.name, id: job?.id, err: error }, 'job failed'),
  );

  const embeddings =
    env.EMBEDDINGS_PROVIDER === 'ollama'
      ? ollamaProvider(env.OLLAMA_URL, env.OLLAMA_EMBED_MODEL)
      : hashingProvider;
  const profileWorker = new Worker(
    PROFILE_QUEUE,
    async (job) => {
      switch (job.name) {
        case ProfileJob.EmbedProfile:
          return embedProfile(db, embeddings, job.data as EmbedProfileJob);
        case 'cleanup-discovery':
          return {
            ...(await cleanupDiscovery(db)),
            ...(await purgeClosedChats(db, storage)),
            ...(await cleanupModeration(db, storage)),
            ...(await cleanupPrivacy(db)),
            ...(await handleInactiveAccounts({
              db,
              storage,
              months: env.INACTIVE_ACCOUNT_DELETE_MONTHS,
              instanceName: env.INSTANCE_NAME,
              sendMail: async (to, subject, text) => {
                await mailer.sendMail({ from: env.SMTP_FROM, to, subject, text });
              },
            })),
          };
        case 'checkins':
          return processCheckins({
            db,
            instanceName: async () => {
              const { rows } = await db.execute<{ name: string | null }>(
                sql`SELECT name FROM instance_settings WHERE id = 1`,
              );
              return rows[0]?.name ?? env.INSTANCE_NAME;
            },
            sendMail: async (m) => {
              await mailer.sendMail({ from: env.SMTP_FROM, ...m });
            },
            remind: async (userId, checkinId) => {
              await sendPush(pushContext, { userId, kind: 'checkin', matchId: checkinId });
            },
          });
        case 'calls':
          return processCalls({
            db,
            deleteRoom: liveKitRooms
              ? async (room) => {
                  try {
                    await liveKitRooms.deleteRoom(room);
                  } catch (error) {
                    if ((error as { status?: number }).status !== 404) throw error;
                  }
                }
              : null,
            publish: ctx.publish!,
          });
        case 'pauses':
          return processPauses({
            db,
            tellVisible: async (userId) => {
              await sendPush(pushContext, { userId, kind: 'visible', matchId: userId });
            },
          });
        case 'trips':
          return processTrips(db);
        case 'availability':
          return processAvailability(db);
        case 'signup-retention':
          return processSignupRetention(db);
        case 'friend-retention':
          return processFriendRetention(db);
        case 'events':
          return processEvents({
            db,
            remind: async (userId, eventId) => {
              await sendPush(pushContext, { userId, kind: 'event', matchId: eventId });
            },
          });
        default:
          throw new Error(`Unknown job: ${job.name}`);
      }
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );
  profileWorker.on('completed', (job, result) => {
    // The call sweep runs every 15 s: only log when it did something.
    const quiet = job.name === 'calls' && result?.missed === 0 && result?.ended === 0;
    if (!quiet) log.info({ job: job.name, result }, 'job done');
  });
  profileWorker.on('failed', (job, error) =>
    log.error({ job: job?.name, err: error }, 'job failed'),
  );

  const notifyWorker = new Worker(
    NOTIFY_QUEUE,
    async (job) => sendPush(pushContext, job.data as PushJob),
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );
  // Only the outcome is logged: never tokens or user ids together with content.
  notifyWorker.on('completed', (job, result) => log.info({ job: job.name, result }, 'job done'));
  notifyWorker.on('failed', (job, error) =>
    log.error({ job: job?.name, err: error }, 'job failed'),
  );

  // Daily retention sweep (idempotent scheduler: safe with several workers).
  const scheduler = new Queue(PROFILE_QUEUE, { connection });
  await scheduler.upsertJobScheduler(
    'cleanup-discovery',
    { pattern: '17 3 * * *' },
    { name: 'cleanup-discovery' },
  );
  // Safety check-ins: reminders, alerts to trusted contacts, retention (every minute).
  await scheduler.upsertJobScheduler('checkins', { every: 60_000 }, { name: 'checkins' });
  // Video dates: missed invitations, the time limit (every 15 seconds; a cheap indexed query).
  await scheduler.upsertJobScheduler('calls', { every: 15_000 }, { name: 'calls' });
  // Community events: day-before reminders and retention (every 10 minutes).
  await scheduler.upsertJobScheduler('events', { every: 600_000 }, { name: 'events' });
  // Travel mode: delete trips 30 days after they ended (hourly).
  await scheduler.upsertJobScheduler('trips', { every: 3_600_000 }, { name: 'trips' });
  // When we're both free: delete slots of closed chats and old lists (hourly).
  await scheduler.upsertJobScheduler(
    'availability',
    { every: 3_600_000 },
    { name: 'availability' },
  );
  // Waitlist entries 90 days after a decision, and expired sign-up permissions (daily).
  await scheduler.upsertJobScheduler(
    'signup-retention',
    { every: 86_400_000 },
    { name: 'signup-retention' },
  );
  // Messages of double chats closed 30 days ago, and used or expired friend links (daily).
  await scheduler.upsertJobScheduler(
    'friend-retention',
    { every: 86_400_000 },
    { name: 'friend-retention' },
  );
  // Take a break: end breaks whose time is up and tell the member (every 5 minutes).
  await scheduler.upsertJobScheduler(
    'pauses',
    { every: PAUSE_SWEEP_SECONDS * 1000 },
    { name: 'pauses' },
  );

  log.info(
    { scanningEnabled, embeddings: embeddings.model, push: env.PUSH_PROVIDER },
    'worker started',
  );
  log.info(creditLine());

  const shutdown = async () => {
    log.info('shutting down');
    await worker.close();
    await profileWorker.close();
    await notifyWorker.close();
    await scheduler.close();
    connection.disconnect();
    publisher.disconnect();
    storage.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Worker failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
