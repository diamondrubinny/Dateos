// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema } from '@nexaheart/db';
import {
  MAX_TRANSCRIPT_LENGTH,
  transcriptLangSchema,
  type TranscribeJobData,
  type TranscriptLang,
} from '@nexaheart/shared';
import { and, eq, sql } from 'drizzle-orm';
import { notifyChatMedia, type JobContext } from './jobs.js';
import type { Transcriber } from './transcribe.js';

const { audioClips, instanceSettings, preferences } = schema;

/**
 * Makes the text of one voice clip (phase 26), only after someone who may play it asked. Runs on
 * this server; the clip and the text never leave it. Throws on a model error, so BullMQ retries;
 * the last attempt marks it failed (see the worker's failed handler).
 */
export async function processTranscript(
  ctx: JobContext,
  transcriber: Transcriber,
  { audioId }: TranscribeJobData,
): Promise<string> {
  const [row] = await ctx.db
    .select({
      userId: audioClips.userId,
      status: audioClips.status,
      mediaKey: audioClips.mediaKey,
      lang: audioClips.lang,
      transcriptStatus: audioClips.transcriptStatus,
    })
    .from(audioClips)
    .where(eq(audioClips.id, audioId));
  if (!row || row.status !== 'clean' || !row.mediaKey || row.transcriptStatus !== 'pending') {
    return 'skipped';
  }
  // The speaker may have changed their mind since the request.
  const [pref] = await ctx.db
    .select({ allow: preferences.allowTranscripts })
    .from(preferences)
    .where(eq(preferences.userId, row.userId));
  if (pref && !pref.allow) {
    await ctx.db
      .update(audioClips)
      .set({ transcript: null, transcriptStatus: null })
      .where(eq(audioClips.id, audioId));
    return 'not allowed';
  }

  const audio = await ctx.storage.getBuffer(ctx.storage.buckets.media, row.mediaKey);
  const text = (await transcriber.transcribe(audio, await languageOf(ctx, row.lang)))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TRANSCRIPT_LENGTH);
  // Only if still pending: a deletion or a "voice only" in the meantime wins.
  const updated = await ctx.db
    .update(audioClips)
    .set(text ? { transcript: text, transcriptStatus: 'done' } : { transcriptStatus: 'failed' })
    .where(and(eq(audioClips.id, audioId), eq(audioClips.transcriptStatus, 'pending')))
    .returning({ id: audioClips.id });
  if (updated.length > 0) await notifyChatMedia(ctx, sql`m.audio_id = ${audioId}`);
  return text ? 'done' : 'empty';
}

/** After the last retry: mark the clip failed so asking again starts a new attempt. */
export async function markTranscriptFailed(ctx: JobContext, audioId: string): Promise<void> {
  await ctx.db
    .update(audioClips)
    .set({ transcriptStatus: 'failed' })
    .where(and(eq(audioClips.id, audioId), eq(audioClips.transcriptStatus, 'pending')));
  await notifyChatMedia(ctx, sql`m.audio_id = ${audioId}`);
}

/** The language the clip was recorded in, else the community's default (older clips). */
async function languageOf(ctx: JobContext, lang: string | null): Promise<TranscriptLang> {
  const parsed = transcriptLangSchema.safeParse(lang);
  if (parsed.success) return parsed.data;
  const [settings] = await ctx.db
    .select({ locale: instanceSettings.defaultLocale })
    .from(instanceSettings)
    .limit(1);
  const fallback = transcriptLangSchema.safeParse(settings?.locale);
  return fallback.success ? fallback.data : 'en';
}
