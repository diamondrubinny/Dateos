// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Queues an embedding job for every profile, e.g. after switching EMBEDDINGS_PROVIDER.
 * Usage: pnpm --filter @nexaheart/worker reembed
 */
import { createDb } from '@nexaheart/db';
import { PROFILE_QUEUE, ProfileJob } from '@nexaheart/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadWorkerEnv } from './env.js';

const env = loadWorkerEnv();
const { pool } = createDb(env.DATABASE_URL, { max: 1 });
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(PROFILE_QUEUE, { connection });
const { rows } = await pool.query<{ user_id: string }>('SELECT user_id FROM profiles');
await queue.addBulk(
  rows.map((r) => ({
    name: ProfileJob.EmbedProfile,
    data: { userId: r.user_id },
    opts: { jobId: `embed-${r.user_id}`, removeOnComplete: true, removeOnFail: true },
  })),
);
process.stdout.write(`Queued ${rows.length} embedding jobs\n`);
await queue.close();
connection.disconnect();
await pool.end();
