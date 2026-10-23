// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * After the match (phase 20): when we're both free, "did you meet?" with private feedback, and a
 * focus mode that asks you to answer people waiting for you before liking new ones.
 */

// ---------------------------------------------------------------- availability

export const dayParts = ['morning', 'afternoon', 'evening'] as const;
export type DayPart = (typeof dayParts)[number];
export const AVAILABILITY_DAYS = 14;
export const MAX_AVAILABILITY_SLOTS = 21;
/** The hour the date planner suggests for each part of the day. */
export const DAY_PART_HOUR: Record<DayPart, number> = { morning: 10, afternoon: 15, evening: 19 };

/** "2026-10-25:evening" */
export const slotSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}:(morning|afternoon|evening)$/);
export const availabilityInputSchema = z.object({
  slots: z
    .array(slotSchema)
    .max(MAX_AVAILABILITY_SLOTS)
    .refine((s) => new Set(s).size === s.length, { message: 'Each slot once' }),
});
/** Only the overlap is shared, never the other person's full list. */
export const availabilitySchema = z.object({
  mine: z.array(slotSchema),
  theyShared: z.boolean(),
  overlap: z.array(slotSchema),
});
export type Availability = z.infer<typeof availabilitySchema>;

export function parseSlot(slot: string): { date: string; part: DayPart } {
  const [date, part] = slot.split(':') as [string, DayPart];
  return { date, part };
}

// ---------------------------------------------------------------- did you meet?

/** The card asks "Did you meet?" this long after an accepted date's start. */
export const FEEDBACK_AFTER_MINUTES = 120;
export const againAnswers = ['yes', 'unsure', 'no'] as const;
export type AgainAnswer = (typeof againAnswers)[number];
export const dateFeedbackInputSchema = z
  .object({ met: z.boolean(), again: z.enum(againAnswers).nullable() })
  .refine((f) => f.met || f.again === null, { message: 'Only after meeting', path: ['again'] });
export type DateFeedbackInput = z.infer<typeof dateFeedbackInputSchema>;
/** What a person sees on the date card: never the other person's answers, except "both again". */
export const dateFeedbackViewSchema = z.object({
  canGive: z.boolean(),
  mine: z.object({ met: z.boolean(), again: z.enum(againAnswers).nullable() }).nullable(),
  bothAgain: z.boolean(),
});
export type DateFeedbackView = z.infer<typeof dateFeedbackViewSchema>;

// ---------------------------------------------------------------- focus mode

/** With this many people waiting for your reply, Discover asks you to answer them first. */
export const YOUR_TURN_LIMIT = 6;
export const yourTurnSchema = z.object({ waiting: z.number().int(), limit: z.number().int() });
export type YourTurn = z.infer<typeof yourTurnSchema>;
