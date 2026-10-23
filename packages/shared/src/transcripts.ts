// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { localeSchema, type Locale } from './common.js';

/**
 * Voice transcripts (phase 26): made on the community's own server by a local speech model, only
 * when someone who may play the clip asks for the text.
 */
export type TranscriptLang = Locale;
export const transcriptLangSchema = localeSchema;

/**
 * `none`: nobody asked yet. `unavailable`: the speaker prefers voice only, or this community has
 * transcripts off. `failed`: the model couldn't make anything of it (silence, noise); asking again
 * retries.
 */
export const transcriptStatuses = ['none', 'pending', 'done', 'failed', 'unavailable'] as const;
export type TranscriptStatus = (typeof transcriptStatuses)[number];

export const transcriptSchema = z.object({
  status: z.enum(transcriptStatuses),
  text: z.string().nullable(),
});
export type Transcript = z.infer<typeof transcriptSchema>;

/** The app's language when a clip is recorded (voice messages and voice prompts). */
export const voiceUploadQuerySchema = z.object({ lang: transcriptLangSchema.optional() });

/** Longest transcript kept (a 2-minute message is far shorter). */
export const MAX_TRANSCRIPT_LENGTH = 4000;
