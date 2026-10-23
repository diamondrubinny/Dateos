// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  MAX_VOICE_PROMPT_SECONDS,
  type PromptKey,
  type Transcript,
  type TranscriptLang,
} from '@nexaheart/shared';
import { audioQuarantineKey, type Storage, type StoredObject } from '@nexaheart/storage';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import type { MediaQueue, TranscribeQueue } from '../../lib/queue.js';
import { HttpError } from '../../plugins/error-handler.js';

const { audioClips, preferences, profileAbout } = schema;

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

  /** Who may see whose profile (and so hear a voice prompt): the discovery visibility rules. */
  private canView?: (viewerId: string, ownerId: string) => Promise<boolean>;
  useVisibility(canView: (viewerId: string, ownerId: string) => Promise<boolean>): void {
    this.canView = canView;
  }

  /** Voice transcripts (phase 26): unset when the community turned them off. */
  private transcripts?: TranscribeQueue;
  useTranscripts(queue: TranscribeQueue): void {
    this.transcripts = queue;
  }

  async upload(
    userId: string,
    buffer: Buffer,
    maxSeconds?: number,
    lang?: TranscriptLang,
  ): Promise<{ id: string }> {
    const mime = await sniffAudioType(buffer);
    if (!mime) throw new HttpError(415, ErrorCode.BadRequest, 'Unsupported audio format.');
    const [row] = await this.db
      .insert(audioClips)
      .values({ userId, ...(lang ? { lang } : {}) })
      .returning({ id: audioClips.id });
    const key = audioQuarantineKey(userId, row!.id);
    try {
      await this.db
        .update(audioClips)
        .set({ quarantineKey: key })
        .where(eq(audioClips.id, row!.id));
      await this.storage.put(this.storage.buckets.quarantine, key, buffer, mime);
      await this.mediaQueue.processAudio({
        audioId: row!.id,
        ...(maxSeconds ? { maxSeconds } : {}),
      });
    } catch (error) {
      await this.db.delete(audioClips).where(eq(audioClips.id, row!.id));
      await this.storage.delete(this.storage.buckets.quarantine, [key]).catch(() => undefined);
      throw error;
    }
    return row!;
  }

  /**
   * Voice prompt (phase 19): one spoken answer on the profile, at most 30 s. Recording a new one
   * replaces (and deletes) the old clip.
   */
  async setVoicePrompt(
    userId: string,
    promptKey: PromptKey,
    buffer: Buffer,
    lang?: TranscriptLang,
  ): Promise<{ id: string }> {
    const clip = await this.upload(userId, buffer, MAX_VOICE_PROMPT_SECONDS, lang);
    const [before] = await this.db
      .select({ audioId: profileAbout.voiceAudioId })
      .from(profileAbout)
      .where(eq(profileAbout.userId, userId));
    const values = { voicePromptKey: promptKey, voiceAudioId: clip.id, updatedAt: new Date() };
    await this.db
      .insert(profileAbout)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: profileAbout.userId, set: values });
    if (before?.audioId) await this.deleteClip(before.audioId);
    return clip;
  }

  async removeVoicePrompt(userId: string): Promise<void> {
    const [row] = await this.db
      .select({ audioId: profileAbout.voiceAudioId })
      .from(profileAbout)
      .where(eq(profileAbout.userId, userId));
    if (!row?.audioId) return;
    await this.db
      .update(profileAbout)
      .set({ voicePromptKey: null, voiceAudioId: null })
      .where(eq(profileAbout.userId, userId));
    await this.deleteClip(row.audioId);
  }

  /**
   * The text of a clip (phase 26), for someone who may play it. `request` queues it when nobody
   * asked yet (or the last attempt failed); otherwise this only reads the state.
   */
  async transcript(viewerId: string, audioId: string, request: boolean): Promise<Transcript> {
    const row = await this.playable(viewerId, audioId);
    if (!row) throw notFound();
    const unavailable: Transcript = { status: 'unavailable', text: null };
    if (!this.transcripts) return unavailable;
    const [pref] = await this.db
      .select({ allow: preferences.allowTranscripts })
      .from(preferences)
      .where(eq(preferences.userId, row.user_id));
    if (pref && !pref.allow) return unavailable;
    if (row.transcript_status === 'done') return { status: 'done', text: row.transcript };
    if (row.transcript_status === 'pending') return { status: 'pending', text: null };
    if (!request) {
      return { status: row.transcript_status === 'failed' ? 'failed' : 'none', text: null };
    }
    // Only one request queues the job, even when both people ask at the same moment.
    const claimed = await this.db
      .update(audioClips)
      .set({ transcriptStatus: 'pending', transcript: null })
      .where(
        and(
          eq(audioClips.id, audioId),
          or(isNull(audioClips.transcriptStatus), eq(audioClips.transcriptStatus, 'failed')),
        ),
      )
      .returning({ id: audioClips.id });
    if (claimed.length > 0) await this.transcripts.transcribe(audioId);
    return { status: 'pending', text: null };
  }

  /** Deletes a clip row now and its stored files through the worker. */
  private async deleteClip(audioId: string): Promise<void> {
    const [clip] = await this.db
      .delete(audioClips)
      .where(eq(audioClips.id, audioId))
      .returning({ q: audioClips.quarantineKey, m: audioClips.mediaKey, o: audioClips.opusKey });
    if (!clip) return;
    await this.mediaQueue.deleteObjects({
      quarantineKeys: clip.q ? [clip.q] : [],
      mediaKeys: [clip.m, clip.o].filter((k): k is string => Boolean(k)),
    });
  }

  /**
   * The clip, if this person may play it: the two people of an active, unblocked match where it was
   * sent, or (a voice prompt) anyone who may see the owner's profile. Transcripts use the same check.
   */
  private async playable(viewerId: string, audioId: string) {
    type Row = {
      user_id: string;
      media_key: string | null;
      opus_key: string | null;
      transcript: string | null;
      transcript_status: string | null;
    };
    const result = await this.db.execute<Row>(sql`
      SELECT a.user_id, a.media_key, a.opus_key, a.transcript, a.transcript_status FROM audio_clips a
      JOIN messages m ON m.audio_id = a.id JOIN matches ma ON ma.id = m.match_id
      WHERE a.id = ${audioId} AND a.status = 'clean' AND ma.unmatched_at IS NULL
        AND (ma.user_a = ${viewerId} OR ma.user_b = ${viewerId})
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ma.user_a AND b.blocked_id = ma.user_b) OR (b.blocker_id = ma.user_b AND b.blocked_id = ma.user_a)
        )
      LIMIT 1`);
    const sent = result.rows[0];
    if (sent) return sent;
    // A voice prompt: anyone who may see the owner's profile can hear it.
    const prompt = await this.db.execute<Row>(sql`
      SELECT a.user_id, a.media_key, a.opus_key, a.transcript, a.transcript_status FROM audio_clips a
      JOIN profile_about pa ON pa.voice_audio_id = a.id AND pa.user_id = a.user_id
      WHERE a.id = ${audioId} AND a.status = 'clean'`);
    const owner = prompt.rows[0];
    if (owner && (owner.user_id === viewerId || (await this.canView?.(viewerId, owner.user_id)))) {
      return owner;
    }
    return undefined;
  }

  async open(
    viewerId: string,
    audioId: string,
    format: 'aac' | 'opus' = 'aac',
  ): Promise<StoredObject> {
    const row = await this.playable(viewerId, audioId);
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
