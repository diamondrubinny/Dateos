// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import type {
  DeleteObjectsJob,
  ProcessAudioJob,
  ProcessPhotoJob,
  RealtimeEvent,
} from '@nexaheart/shared';
import { audioMediaKey, mediaKey, type Storage } from '@nexaheart/storage';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Scanner } from './clamav.js';
import { InvalidAudioError, transcodeVoice } from './audio.js';
import {
  BANNED_PHOTO_DISTANCE,
  InvalidImageError,
  perceptualHash,
  processImage,
  SAME_PHOTO_DISTANCE,
} from './image.js';

const { photos, audioClips, auditLogs, reports } = schema;

export interface JobContext {
  db: Database;
  storage: Storage;
  scanner: Scanner;
  scanningEnabled: boolean;
  log: Logger;
  /** ffmpeg/ffprobe binaries for voice messages (default: from PATH). */
  ffmpegPath?: string;
  ffprobePath?: string;
  /** Publishes a realtime event to a user (chat images: tell both people the scan finished). */
  publish?: (userId: string, event: RealtimeEvent) => Promise<void>;
}

/** For chat media, tell both participants that the message changed (now visible or rejected). */
async function notifyChatImage(ctx: JobContext, photoId: string): Promise<void> {
  return notifyChatMedia(ctx, sql`m.photo_id = ${photoId}`);
}

export async function notifyChatMedia(
  ctx: JobContext,
  where: ReturnType<typeof sql>,
): Promise<void> {
  if (!ctx.publish) return;
  const rows = await ctx.db.execute<{
    message_id: string;
    match_id: string;
    user_a: string;
    user_b: string;
  }>(sql`
    SELECT m.id AS message_id, m.match_id, ma.user_a, ma.user_b
    FROM messages m JOIN matches ma ON ma.id = m.match_id
    WHERE ${where}`);
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

  // Profile photos only (phase 21): a banned account's photo is refused, a copy of another
  // member's photo opens a case for the moderators.
  const phash = row.purpose === 'profile' ? await perceptualHash(processed.data) : null;
  if (phash !== null && (await matchesBannedPhoto(ctx, phash))) {
    await reject(ctx, photoId, row.userId, 'banned_photo', row.quarantineKey);
    await autoReport(
      ctx,
      row.userId,
      'high',
      'Automatic: a new profile photo matches a photo of a banned account. It was not published.',
    );
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
      phash,
    })
    .where(and(eq(photos.id, photoId), eq(photos.userId, row.userId)))
    .returning({ id: photos.id });
  if (updated.length === 0) {
    // The photo or account was deleted while processing: do not leave an orphaned file.
    await ctx.storage.delete(ctx.storage.buckets.media, [key]);
  }
  await ctx.storage.delete(ctx.storage.buckets.quarantine, [row.quarantineKey]);
  if (updated.length > 0) await notifyChatImage(ctx, photoId);
  if (updated.length > 0 && phash !== null) {
    const others = await sameProfilePhotoOwners(ctx, row.userId, phash);
    if (others.length > 0) {
      await autoReport(
        ctx,
        row.userId,
        'normal',
        `Automatic: a profile photo looks the same as a photo of ${others.length === 1 ? 'another account' : `${others.length} other accounts`} (${others.join(', ')}). Could be a shared photo or a copied profile.`,
      );
    }
  }
  return updated.length === 0 ? 'orphaned' : 'clean';
}

/** Hamming distance between two signed 64-bit hashes, in SQL. */
const distance = (column: ReturnType<typeof sql>, hash: bigint) =>
  sql`bit_count((${column} # ${hash.toString()}::bigint)::bit(64))`;

async function matchesBannedPhoto(ctx: JobContext, hash: bigint): Promise<boolean> {
  const { rows } = await ctx.db.execute(sql`
    SELECT 1 FROM banned_photo_hashes b
    WHERE ${distance(sql`b.hash`, hash)} <= ${BANNED_PHOTO_DISTANCE} LIMIT 1`);
  return rows.length > 0;
}

/** Other accounts with a clean profile photo that looks the same (at most five, for the case). */
async function sameProfilePhotoOwners(
  ctx: JobContext,
  userId: string,
  hash: bigint,
): Promise<string[]> {
  const { rows } = await ctx.db.execute<{ user_id: string }>(sql`
    SELECT DISTINCT p.user_id FROM photos p
    WHERE p.phash IS NOT NULL AND p.user_id <> ${userId} AND p.status = 'clean'
      AND p.purpose = 'profile' AND ${distance(sql`p.phash`, hash)} <= ${SAME_PHOTO_DISTANCE}
    LIMIT 5`);
  return rows.map((r) => r.user_id);
}

/**
 * Opens a report with no reporter (the system), unless one is already open for this member:
 * moderators see it in the usual queue, with the same tools and audit trail.
 */
async function autoReport(
  ctx: JobContext,
  reportedId: string,
  priority: 'high' | 'normal',
  details: string,
): Promise<void> {
  const [open] = await ctx.db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reportedId, reportedId),
        eq(reports.status, 'open'),
        eq(reports.automatic, true),
        eq(reports.category, 'fake_profile'),
      ),
    );
  if (open) return;
  await ctx.db.insert(reports).values({
    reporterId: null,
    reportedId,
    category: 'fake_profile',
    priority,
    details,
    automatic: true,
  });
  await ctx.db.insert(auditLogs).values({
    actorId: null,
    action: 'report.automatic',
    targetType: 'user',
    targetId: reportedId,
    meta: { reason: priority === 'high' ? 'banned_photo' : 'same_photo' },
  });
}

export async function deleteObjects(ctx: JobContext, job: DeleteObjectsJob): Promise<void> {
  await ctx.storage.delete(ctx.storage.buckets.quarantine, job.quarantineKeys);
  await ctx.storage.delete(ctx.storage.buckets.media, job.mediaKeys);
}

/** Voice messages: quarantine → malware scan → re-encode to clean AAC/M4A → visible. */
export async function processAudio(
  ctx: JobContext,
  { audioId, maxSeconds }: ProcessAudioJob,
): Promise<string> {
  const [row] = await ctx.db.select().from(audioClips).where(eq(audioClips.id, audioId));
  if (!row || !row.quarantineKey || (row.status !== 'quarantine' && row.status !== 'processing')) {
    return 'skipped';
  }
  await ctx.db.update(audioClips).set({ status: 'processing' }).where(eq(audioClips.id, audioId));
  const original = await ctx.storage.getBuffer(ctx.storage.buckets.quarantine, row.quarantineKey);
  const notify = () => notifyChatMedia(ctx, sql`m.audio_id = ${audioId}`);
  const rejectAudio = async (reason: string) => {
    await ctx.db
      .update(audioClips)
      .set({ status: 'rejected', rejectReason: reason, quarantineKey: null })
      .where(eq(audioClips.id, audioId));
    await ctx.db.insert(auditLogs).values({
      actorId: null,
      action: 'audio.rejected',
      targetType: 'audio',
      targetId: audioId,
      meta: { reason, owner: row.userId },
    });
    await ctx.storage.delete(ctx.storage.buckets.quarantine, [row.quarantineKey!]);
    await notify();
    return 'rejected';
  };

  if (ctx.scanningEnabled) {
    const result = await ctx.scanner.scan(original);
    if (!result.clean) {
      ctx.log.warn(
        { audioId, signature: result.signature },
        'malware detected; voice message rejected',
      );
      return rejectAudio('malware');
    }
  } else {
    ctx.log.warn({ audioId }, 'MALWARE_SCAN=disabled: voice message was not scanned');
  }

  let processed;
  try {
    processed = await transcodeVoice(original, {
      ffmpeg: ctx.ffmpegPath,
      ffprobe: ctx.ffprobePath,
      maxSeconds,
    });
  } catch (error) {
    if (!(error instanceof InvalidAudioError)) throw error;
    return rejectAudio(error.message);
  }

  const key = audioMediaKey(row.userId, audioId, 'm4a');
  const opusKey = audioMediaKey(row.userId, audioId, 'webm');
  await ctx.storage.put(ctx.storage.buckets.media, key, processed.data, 'audio/mp4');
  await ctx.storage.put(ctx.storage.buckets.media, opusKey, processed.opus, 'audio/webm');
  const updated = await ctx.db
    .update(audioClips)
    .set({
      status: 'clean',
      mediaKey: key,
      opusKey,
      quarantineKey: null,
      durationMs: processed.durationMs,
    })
    .where(and(eq(audioClips.id, audioId), eq(audioClips.userId, row.userId)))
    .returning({ id: audioClips.id });
  if (updated.length === 0) await ctx.storage.delete(ctx.storage.buckets.media, [key, opusKey]);
  await ctx.storage.delete(ctx.storage.buckets.quarantine, [row.quarantineKey]);
  if (updated.length > 0) await notify();
  return updated.length === 0 ? 'orphaned' : 'clean';
}
