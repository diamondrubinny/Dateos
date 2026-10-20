import { createDb } from '@dateos/db';
import { MEDIA_QUEUE, MediaJob, type DeleteObjectsJob, type ProcessPhotoJob } from '@dateos/shared';
import { createStorage } from '@dateos/storage';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createClamavScanner, noopScanner } from './clamav.js';
import { loadWorkerEnv } from './env.js';
import { deleteObjects, processPhoto, type JobContext } from './jobs.js';

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

  const scanningEnabled = env.MALWARE_SCAN === 'clamav';
  if (!scanningEnabled) log.warn('Lite mode: MALWARE_SCAN=disabled, uploads are NOT scanned');
  const ctx: JobContext = {
    db,
    storage,
    scanner: scanningEnabled ? createClamavScanner(env.CLAMAV_HOST, env.CLAMAV_PORT) : noopScanner,
    scanningEnabled,
    log,
  };

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker(
    MEDIA_QUEUE,
    async (job) => {
      switch (job.name) {
        case MediaJob.ProcessPhoto:
          return processPhoto(ctx, job.data as ProcessPhotoJob);
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
  log.info({ scanningEnabled }, 'worker started');

  const shutdown = async () => {
    log.info('shutting down');
    await worker.close();
    connection.disconnect();
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
