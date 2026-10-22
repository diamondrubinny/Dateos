import { schema, type Database } from '@nexaheart/db';
import { ErrorCode } from '@nexaheart/shared';
import { audioQuarantineKey, type Storage, type StoredObject } from '@nexaheart/storage';
import { and, eq, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import type { MediaQueue } from '../../lib/queue.js';
import { HttpError } from '../../plugins/error-handler.js';

const { audioClips } = schema;

/** What phones and browsers record: M4A/MP4 (iOS, Android, Safari), WebM (Chrome), Ogg (Firefox). */
const allowed = new Set([
  'audio/mp4',
  'audio/x-m4a',
  'video/mp4',
  'audio/webm',
  'video/webm',
  'audio/ogg',
  'audio/opus',
]);

export async function sniffAudioType(buffer: Buffer): Promise<string | undefined> {
  const detected = await fileTypeFromBuffer(buffer);
  const base = detected?.mime.split(';')[0]!.trim();
  return base && allowed.has(base) ? base : undefined;
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

export class AudioService {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly mediaQueue: MediaQueue,
  ) {}

  async upload(userId: string, buffer: Buffer): Promise<{ id: string }> {
    const mime = await sniffAudioType(buffer);
    if (!mime) throw new HttpError(415, ErrorCode.BadRequest, 'Unsupported audio format.');
    const [row] = await this.db
      .insert(audioClips)
      .values({ userId })
      .returning({ id: audioClips.id });
    const key = audioQuarantineKey(userId, row!.id);
    try {
      await this.db
        .update(audioClips)
        .set({ quarantineKey: key })
        .where(eq(audioClips.id, row!.id));
      await this.storage.put(this.storage.buckets.quarantine, key, buffer, mime);
      await this.mediaQueue.processAudio({ audioId: row!.id });
    } catch (error) {
      await this.db.delete(audioClips).where(eq(audioClips.id, row!.id));
      await this.storage.delete(this.storage.buckets.quarantine, [key]).catch(() => undefined);
      throw error;
    }
    return row!;
  }

  /** Only the two people of an active match where the clip was sent can play it. */
  async open(
    viewerId: string,
    audioId: string,
    format: 'aac' | 'opus' = 'aac',
  ): Promise<StoredObject> {
    const result = await this.db.execute<{ media_key: string | null; opus_key: string | null }>(sql`
      SELECT a.media_key, a.opus_key FROM audio_clips a
      JOIN messages m ON m.audio_id = a.id JOIN matches ma ON ma.id = m.match_id
      WHERE a.id = ${audioId} AND a.status = 'clean' AND ma.unmatched_at IS NULL
        AND (ma.user_a = ${viewerId} OR ma.user_b = ${viewerId})
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ma.user_a AND b.blocked_id = ma.user_b) OR (b.blocker_id = ma.user_b AND b.blocked_id = ma.user_a)
        )
      LIMIT 1`);
    const row = result.rows[0];
    const key = format === 'opus' ? row?.opus_key : row?.media_key;
    if (!key) throw notFound();
    return this.storage.get(this.storage.buckets.media, key);
  }

  async keysOf(userId: string): Promise<{ quarantineKeys: string[]; mediaKeys: string[] }> {
    const rows = await this.db
      .select({ q: audioClips.quarantineKey, m: audioClips.mediaKey, o: audioClips.opusKey })
      .from(audioClips)
      .where(and(eq(audioClips.userId, userId)));
    return {
      quarantineKeys: rows.flatMap((r) => (r.q ? [r.q] : [])),
      mediaKeys: rows.flatMap((r) => [r.m, r.o].filter((k): k is string => Boolean(k))),
    };
  }
}
