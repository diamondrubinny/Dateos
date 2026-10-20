import { MEDIA_QUEUE, MediaJob, type DeleteObjectsJob, type ProcessPhotoJob } from '@dateos/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export interface MediaQueue {
  processPhoto(job: ProcessPhotoJob): Promise<void>;
  deleteObjects(job: DeleteObjectsJob): Promise<void>;
  close(): Promise<void>;
}

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export function createMediaQueue(redisUrl: string): MediaQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => undefined);
  const queue = new Queue(MEDIA_QUEUE, { connection, defaultJobOptions });
  return {
    async processPhoto(job) {
      // jobId = photoId makes retries of the same upload idempotent.
      await queue.add(MediaJob.ProcessPhoto, job, { jobId: `photo-${job.photoId}` });
    },
    async deleteObjects(job) {
      if (job.quarantineKeys.length === 0 && job.mediaKeys.length === 0) return;
      await queue.add(MediaJob.DeleteObjects, job);
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
