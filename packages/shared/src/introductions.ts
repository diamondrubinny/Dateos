// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { genderSchema, intentionSchema, MAX_AGE, MIN_AGE } from './profile.js';

/**
 * Phase 68a: community matchmakers, named by the admins, introduce two members who opted in.
 * Each side answers privately; two yeses open a chat. A no is never shown to anyone: the other
 * side and the matchmaker only see "didn't go ahead" once the introduction expires, as with no
 * answer. See docs/phases/PHASE-68.md.
 */
export const MAX_INTRODUCTION_NOTE = 300;
/** Introductions one matchmaker may send in 24 hours. */
export const INTRODUCTIONS_DAILY = 20;
/** Days to answer (counted again for the second side when the first said yes). */
export const INTRODUCTION_DAYS = 14;
/** Closed introductions are deleted after this many days (the worker's retention job). */
export const INTRODUCTION_RETENTION_DAYS = 365;

/** Who hears first: both together, or (when one of the two is a woman) the woman. */
export const introductionOrders = ['together', 'women_first'] as const;
export type IntroductionOrder = (typeof introductionOrders)[number];

export const introductionAnswers = ['yes', 'no'] as const;
export type IntroductionAnswer = (typeof introductionAnswers)[number];

/** What either of the two can tell the matchmaker after a match. */
export const introductionOutcomes = ['met', 'engaged', 'married'] as const;
export type IntroductionOutcome = (typeof introductionOutcomes)[number];

/** Open: waiting for answers; matched: two yeses; closed: expired (or the matchmaker left). */
export const introductionStates = ['open', 'matched', 'closed'] as const;
export type IntroductionState = (typeof introductionStates)[number];

const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .refine((v) => !/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F<>]/.test(v), 'Plain text only');

const memberId = z.string().min(1).max(64);

export const introductionInputSchema = z
  .object({ aId: memberId, bId: memberId, note: plain(MAX_INTRODUCTION_NOTE) })
  .strict()
  .refine((v) => v.aId !== v.bId, 'Two different members');
export type IntroductionInput = z.infer<typeof introductionInputSchema>;

export const introductionAnswerSchema = z.object({ answer: z.enum(introductionAnswers) }).strict();
export const introductionOutcomeSchema = z
  .object({ outcome: z.enum(introductionOutcomes) })
  .strict();

/** The console's search: only members open to matchmakers. */
export const consoleQuerySchema = z
  .object({
    q: z.string().trim().max(60).optional(),
    gender: genderSchema.optional(),
    minAge: z.coerce.number().int().min(MIN_AGE).max(MAX_AGE).optional(),
    maxAge: z.coerce.number().int().min(MIN_AGE).max(MAX_AGE).optional(),
  })
  .strict();
export type ConsoleQuery = z.infer<typeof consoleQuerySchema>;

export const consoleMemberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  intention: intentionSchema,
  /** The first profile photo, served under the usual rules (blurred stays blurred). */
  photoUrl: z.string().nullable(),
});
export type ConsoleMember = z.infer<typeof consoleMemberSchema>;

const personSchema = z.object({ id: z.string(), displayName: z.string() });

/** The matchmaker as an introduced member sees them, with the community's badge. */
export const introducerSchema = z.object({
  displayName: z.string(),
  /** Since when the admins named them; null when they're no longer a matchmaker. */
  since: z.string().nullable(),
});

/** An introduction I received (never the other side's answer). */
export const receivedIntroductionSchema = z.object({
  id: z.uuid(),
  matchmaker: introducerSchema.nullable(),
  note: z.string(),
  other: personSchema.extend({ photoUrl: z.string().nullable() }),
  myAnswer: z.enum(introductionAnswers).nullable(),
  state: z.enum(introductionStates),
  matchId: z.uuid().nullable(),
  outcome: z.enum(introductionOutcomes).nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type ReceivedIntroduction = z.infer<typeof receivedIntroductionSchema>;

/** An introduction I sent as a matchmaker: its state, never who said what. */
export const sentIntroductionSchema = z.object({
  id: z.uuid(),
  a: personSchema,
  b: personSchema,
  note: z.string(),
  state: z.enum(introductionStates),
  outcome: z.enum(introductionOutcomes).nullable(),
  createdAt: z.string(),
});
export type SentIntroduction = z.infer<typeof sentIntroductionSchema>;

export const myIntroductionsSchema = z.object({
  received: z.array(receivedIntroductionSchema),
  /** Since when I'm a community matchmaker, or null. */
  matchmakerSince: z.string().nullable(),
});
export type MyIntroductions = z.infer<typeof myIntroductionsSchema>;

export const consoleSchema = z.object({
  members: z.array(consoleMemberSchema),
  sent: z.array(sentIntroductionSchema),
  /** Introductions I may still send in the next 24 hours. */
  left: z.number().int(),
});
export type MatchmakerConsole = z.infer<typeof consoleSchema>;

// ---------------------------------------------------------------- dashboard

export const grantMatchmakerSchema = z.object({ email: z.email().max(254) }).strict();

export const matchmakerReportQuerySchema = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .strict();

export const matchmakerRowSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  since: z.string(),
  /** In the chosen period (all time without one). */
  introductions: z.number().int(),
  matches: z.number().int(),
  met: z.number().int(),
  engaged: z.number().int(),
  married: z.number().int(),
});
export type MatchmakerRow = z.infer<typeof matchmakerRowSchema>;
export const matchmakersReportSchema = z.object({ matchmakers: z.array(matchmakerRowSchema) });

/**
 * The report as CSV, counts only (no member names besides the matchmaker's own). Cells that start
 * like a formula are quoted with a leading apostrophe, as spreadsheets expect.
 */
export function matchmakersCsv(rows: MatchmakerRow[]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['matchmaker', 'since', 'introductions', 'matches', 'met', 'engaged', 'married'];
  const lines = rows.map((r) =>
    [r.displayName, r.since.slice(0, 10), r.introductions, r.matches, r.met, r.engaged, r.married]
      .map(cell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n') + '\n';
}

/** Who hears first: the woman when exactly one of the two is a woman and the community asks. */
export function firstToHear(
  order: IntroductionOrder,
  a: { id: string; gender: string },
  b: { id: string; gender: string },
): string | null {
  if (order !== 'women_first') return null;
  if (a.gender === 'woman' && b.gender !== 'woman') return a.id;
  if (b.gender === 'woman' && a.gender !== 'woman') return b.id;
  return null;
}
