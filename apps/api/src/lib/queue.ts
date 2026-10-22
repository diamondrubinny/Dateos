import {
  MEDIA_QUEUE,
  MediaJob,
  NOTIFY_QUEUE,
  NotifyJob,
  PROFILE_QUEUE,
  ProfileJob,
  type DeleteObjectsJob,
  type ProcessAudioJob,
  type ProcessPhotoJob,
  type PushJob,
} from '@dateos/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export interface MediaQueue {
  processPhoto(job: ProcessPhotoJob): Promise<void>;
  processAudio(job: ProcessAudioJob): Promise<void>;
  deleteObjects(job: DeleteObjectsJob): Promise<void>;
  close(): Promise<void>;
}

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export function embedJobOptions(userId: string) {
  return { jobId: `embed-${userId}`, delay: 2_000, removeOnComplete: true, removeOnFail: true };
}

export interface ProfileQueue {
  /** Recompute the profile embedding after the bio or prompts change. */
  embedProfile(userId: string): Promise<void>;
  close(): Promise<void>;
}

/** `name` is overridable for isolated tests only. */
export function createProfileQueue(redisUrl: string, name: string = PROFILE_QUEUE): ProfileQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => undefined);
  const queue = new Queue(name, { connection, defaultJobOptions });
  return {
    async embedProfile(userId) {
      // Debounced per user: edits while a job is pending collapse into it. Finished jobs are
      // removed, because BullMQ silently drops new jobs whose id still exists (even completed).
      await queue.add(ProfileJob.EmbedProfile, { userId }, embedJobOptions(userId));
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}

export function createMediaQueue(redisUrl: string): MediaQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => undefined);
  const queue = new Queue(MEDIA_QUEUE, { connection, defaultJobOptions });
  return {
    async processPhoto(job) {
      // jobId = photoId makes retries of the same upload idempotent.
      await queue.add(MediaJob.ProcessPhoto, job, { jobId: `photo-${job.photoId}` });
    },
    async processAudio(job) {
      await queue.add(MediaJob.ProcessAudio, job, { jobId: `audio-${job.audioId}` });
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

export interface NotifyQueue {
  push(job: PushJob): Promise<void>;
  close(): Promise<void>;
}

export function createNotifyQueue(redisUrl: string, name: string = NOTIFY_QUEUE): NotifyQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => undefined);
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 1_000,
    },
  });
  return {
    async push(job) {
      await queue.add(NotifyJob.Push, job);
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
