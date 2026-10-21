import { schema, type Database } from '@dateos/db';
import type { DeleteObjectsJob, ProcessPhotoJob, RealtimeEvent } from '@dateos/shared';
import { mediaKey, type Storage } from '@dateos/storage';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Scanner } from './clamav.js';
import { InvalidImageError, processImage } from './image.js';

const { photos, auditLogs } = schema;

export interface JobContext {
  db: Database;
  storage: Storage;
  scanner: Scanner;
  scanningEnabled: boolean;
  log: Logger;
  /** Publishes a realtime event to a user (chat images: tell both people the scan finished). */
  publish?: (userId: string, event: RealtimeEvent) => Promise<void>;
}

/** For chat images, tell both participants that the message changed (now visible or rejected). */
async function notifyChatImage(ctx: JobContext, photoId: string): Promise<void> {
  if (!ctx.publish) return;
  const rows = await ctx.db.execute<{
    message_id: string;
    match_id: string;
    user_a: string;
    user_b: string;
  }>(sql`
    SELECT m.id AS message_id, m.match_id, ma.user_a, ma.user_b
    FROM messages m JOIN matches ma ON ma.id = m.match_id
    WHERE m.photo_id = ${photoId}`);
  for (const r of rows.rows) {
    for (const userId of [r.user_a, r.user_b]) {
      await ctx.publish(userId, {
        type: 'message.updated',
        matchId: r.match_id,
        messageId: r.message_id,
      });
    }
  }
}

async function reject(
  ctx: JobContext,
  photoId: string,
  userId: string,
  reason: string,
  key: string,
) {
  await ctx.db
    .update(photos)
    .set({ status: 'rejected', rejectReason: reason, quarantineKey: null })
    .where(eq(photos.id, photoId));
  await ctx.db.insert(auditLogs).values({
    actorId: null,
    action: 'photo.rejected',
    targetType: 'photo',
    targetId: photoId,
    meta: { reason, owner: userId },
  });
  await ctx.storage.delete(ctx.storage.buckets.quarantine, [key]);
}

export async function processPhoto(ctx: JobContext, { photoId }: ProcessPhotoJob): Promise<string> {
  const [row] = await ctx.db.select().from(photos).where(eq(photos.id, photoId));
  // Deleted meanwhile, or already handled by a previous attempt: nothing to do.
  if (!row || !row.quarantineKey || (row.status !== 'quarantine' && row.status !== 'processing')) {
    return 'skipped';
  }
  await ctx.db.update(photos).set({ status: 'processing' }).where(eq(photos.id, photoId));

  const original = await ctx.storage.getBuffer(ctx.storage.buckets.quarantine, row.quarantineKey);

  if (ctx.scanningEnabled) {
    const result = await ctx.scanner.scan(original);
    if (!result.clean) {
      ctx.log.warn({ photoId, signature: result.signature }, 'malware detected; upload rejected');
      await reject(ctx, photoId, row.userId, 'malware', row.quarantineKey);
      await notifyChatImage(ctx, photoId);
      return 'rejected';
    }
  } else {
    ctx.log.warn({ photoId }, 'MALWARE_SCAN=disabled: photo was not scanned');
  }

  let processed;
  try {
    processed = await processImage(original);
  } catch (error) {
    if (!(error instanceof InvalidImageError)) throw error;
    await reject(ctx, photoId, row.userId, error.message, row.quarantineKey);
    await notifyChatImage(ctx, photoId);
    return 'rejected';
  }

  const key = mediaKey(row.userId, photoId);
  await ctx.storage.put(ctx.storage.buckets.media, key, processed.data, 'image/webp');
  const updated = await ctx.db
    .update(photos)
    .set({
      status: 'clean',
      mediaKey: key,
      quarantineKey: null,
      width: processed.width,
      height: processed.height,
    })
    .where(and(eq(photos.id, photoId), eq(photos.userId, row.userId)))
    .returning({ id: photos.id });
  if (updated.length === 0) {
    // The photo or account was deleted while processing: do not leave an orphaned file.
    await ctx.storage.delete(ctx.storage.buckets.media, [key]);
  }
  await ctx.storage.delete(ctx.storage.buckets.quarantine, [row.quarantineKey]);
  if (updated.length > 0) await notifyChatImage(ctx, photoId);
  return updated.length === 0 ? 'orphaned' : 'clean';
}

export async function deleteObjects(ctx: JobContext, job: DeleteObjectsJob): Promise<void> {
  await ctx.storage.delete(ctx.storage.buckets.quarantine, job.quarantineKeys);
  await ctx.storage.delete(ctx.storage.buckets.media, job.mediaKeys);
}
