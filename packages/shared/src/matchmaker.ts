// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { childrenOptions, interestKeys, MAX_INTERESTS, smokingOptions } from './about.js';
import { intentionSchema, MAX_AGE, MIN_AGE } from './profile.js';

/**
 * The matchmaker (phase 23): a short interview whose answers become suggested changes, never
 * applied without the member. See docs/phases/PHASE-23.md.
 */
export const distanceAnswers = ['near', 'city', 'region', 'far'] as const;
export const ageAnswers = ['younger', 'similar', 'older', 'wide'] as const;
export const smokingAnswers = ['no_smokers', 'any'] as const;
export const childrenAnswers = ['want', 'dont_want', 'any'] as const;
export const MATCHMAKER_TEXT_MAX = 500;
/** Free-text interpretations a member can ask for each day. */
export const MATCHMAKER_DAILY = 20;

const unique = <T>(items: T[]) => new Set(items).size === items.length;
const enjoy = z
  .array(z.enum(interestKeys))
  .max(MAX_INTERESTS)
  .refine(unique, { message: 'Each interest once' });

/** The chip answers. Every one is optional: skipping a question is fine. */
export const matchmakerChoicesSchema = z
  .object({
    looking: intentionSchema,
    distance: z.enum(distanceAnswers),
    ages: z.enum(ageAnswers),
    enjoy,
    smoking: z.enum(smokingAnswers),
    children: z.enum(childrenAnswers),
  })
  .partial()
  .strict();
export type MatchmakerChoices = z.infer<typeof matchmakerChoicesSchema>;

export const matchmakerAnswersSchema = z
  .object({
    choices: matchmakerChoicesSchema,
    /** "In your own words": read by a model only when one is available (and allowed). */
    text: z.string().trim().max(MATCHMAKER_TEXT_MAX).default(''),
  })
  .strict();
export type MatchmakerAnswers = z.input<typeof matchmakerAnswersSchema>;

const ages = z
  .object({
    ageMin: z.number().int().min(MIN_AGE).max(MAX_AGE),
    ageMax: z.number().int().min(MIN_AGE).max(MAX_AGE),
  })
  .refine((a) => a.ageMin <= a.ageMax, { message: 'ageMin must be <= ageMax' });

/** One proposed change: the value it would set. Gender, orientation and religion are never here. */
export const matchmakerChangeSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('intention'), value: intentionSchema }).strict(),
  z.object({ field: z.literal('maxDistanceKm'), value: z.number().int().min(1).max(500) }).strict(),
  z.object({ field: z.literal('ages'), value: ages }).strict(),
  z.object({ field: z.literal('interests'), value: enjoy }).strict(),
  z
    .object({
      field: z.literal('smokingOk'),
      value: z.array(z.enum(smokingOptions)).max(smokingOptions.length).refine(unique),
    })
    .strict(),
  z
    .object({
      field: z.literal('childrenOk'),
      value: z.array(z.enum(childrenOptions)).max(childrenOptions.length).refine(unique),
    })
    .strict(),
]);
export type MatchmakerChange = z.infer<typeof matchmakerChangeSchema>;
export type MatchmakerField = MatchmakerChange['field'];

/** A suggestion as shown: the change, and the value it replaces. */
export const matchmakerSuggestionSchema = z.object({
  change: matchmakerChangeSchema,
  current: z.unknown(),
});
export type MatchmakerSuggestion = {
  change: MatchmakerChange;
  current: MatchmakerChange['value'] | null;
};

export const matchmakerResultSchema = z.object({
  suggestions: z.array(matchmakerSuggestionSchema),
  /** Whether the free text was read by a model. */
  usedText: z.boolean(),
  /** Why the free text wasn't read, when there was some. */
  textSkipped: z.enum(['needs_consent', 'unavailable']).nullable(),
});

export const matchmakerApplySchema = z
  .object({ changes: z.array(matchmakerChangeSchema).min(1).max(6) })
  .strict()
  .refine((v) => unique(v.changes.map((c) => c.field)), { message: 'Each field once' });

export const matchmakerInfoSchema = z.object({
  /** Whether "in your own words" can be read: by a local model, or an external one you allowed. */
  text: z.enum(['available', 'needs_consent', 'unavailable']),
});
