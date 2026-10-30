// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { allStreams, faiths } from './faith.js';

/**
 * About me (phase 19): interests, lifestyle, an opening question and dealbreakers. Every field is
 * optional; fixed lists (not free text) keep them translatable, searchable and free of abuse.
 */
export const interestKeys = [
  'hiking',
  'running',
  'gym',
  'yoga',
  'cycling',
  'swimming',
  'football',
  'basketball',
  'dancing',
  'live_music',
  'playing_music',
  'singing',
  'cooking',
  'baking',
  'coffee',
  'wine',
  'foodie',
  'travel',
  'camping',
  'beach',
  'nature',
  'photography',
  'art',
  'museums',
  'theatre',
  'cinema',
  'series',
  'reading',
  'writing',
  'board_games',
  'video_games',
  'tech',
  'science',
  'volunteering',
  'dogs',
  'cats',
  'gardening',
  'fashion',
  'meditation',
  'languages',
] as const;
export type InterestKey = (typeof interestKeys)[number];
export const MAX_INTERESTS = 10;

export const childrenOptions = [
  'have_want_more',
  'have_no_more',
  'want',
  'dont_want',
  'open',
] as const;
export type ChildrenOption = (typeof childrenOptions)[number];
export const smokingOptions = ['no', 'sometimes', 'yes'] as const;
export type SmokingOption = (typeof smokingOptions)[number];
export const drinkingOptions = ['no', 'socially', 'often'] as const;
/**
 * Religious observance: special-category data (GDPR Art. 9), stored only with the `religion`
 * consent ⚖️. Never used for ranking, only as a filter the member chooses.
 */
export const religionOptions = [
  'not_religious',
  'traditional',
  'religious',
  'very_religious',
  'spiritual',
] as const;
/** Phase 62b: relationship history (optional; not special-category data). */
export const relationshipHistories = ['never_married', 'divorced', 'separated', 'widowed'] as const;
export type RelationshipHistory = (typeof relationshipHistories)[number];
export const HEIGHT_MIN_CM = 120;
export const HEIGHT_MAX_CM = 230;
export const OPENING_QUESTION_MAX = 140;
/** Ready-made opening questions (the text is translated in the app). */
export const openingSuggestions = [
  'best_trip',
  'perfect_weekend',
  'comfort_food',
  'last_laugh',
  'hidden_talent',
] as const;

const unique = <T>(items: T[]) => new Set(items).size === items.length;
const height = z.number().int().min(HEIGHT_MIN_CM).max(HEIGHT_MAX_CM);

export const aboutSchema = z.object({
  interests: z
    .array(z.enum(interestKeys))
    .max(MAX_INTERESTS)
    .refine(unique, { message: 'Each interest once' }),
  children: z.enum(childrenOptions).nullable(),
  smoking: z.enum(smokingOptions).nullable(),
  drinking: z.enum(drinkingOptions).nullable(),
  heightCm: height.nullable(),
  religion: z.enum(religionOptions).nullable(),
  openingQuestion: z.string().trim().min(1).max(OPENING_QUESTION_MAX).nullable(),
  relationshipHistory: z.enum(relationshipHistories).nullable().default(null),
});
export type About = z.infer<typeof aboutSchema>;

export const emptyAbout: About = {
  interests: [],
  children: null,
  smoking: null,
  drinking: null,
  heightCm: null,
  religion: null,
  openingQuestion: null,
  relationshipHistory: null,
};

/**
 * Dealbreakers: an empty list means "any". They apply both ways, and a missing answer always
 * passes, so leaving a field empty is never a penalty.
 */
export const dealbreakersSchema = z
  .object({
    smokingOk: z.array(z.enum(smokingOptions)).max(smokingOptions.length).refine(unique),
    childrenOk: z.array(z.enum(childrenOptions)).max(childrenOptions.length).refine(unique),
    religionOk: z.array(z.enum(religionOptions)).max(religionOptions.length).refine(unique),
    /** Phase 62b, the faith module: an empty list means any; a missing answer always passes. */
    faithOk: z.array(z.enum(faiths)).max(faiths.length).refine(unique).default([]),
    streamOk: z.array(z.enum(allStreams)).max(allStreams.length).refine(unique).default([]),
    heightMin: height.nullable(),
    heightMax: height.nullable(),
  })
  .refine((d) => d.heightMin === null || d.heightMax === null || d.heightMin <= d.heightMax, {
    message: 'heightMin must be <= heightMax',
    path: ['heightMin'],
  });
export type Dealbreakers = z.infer<typeof dealbreakersSchema>;

export const noDealbreakers: Dealbreakers = {
  smokingOk: [],
  childrenOk: [],
  religionOk: [],
  faithOk: [],
  streamOk: [],
  heightMin: null,
  heightMax: null,
};

/** Version of the in-app text for the `religion` consent; bump it when the wording changes. */
export const RELIGION_CONSENT_VERSION = '1';

/**
 * Accessibility needs (phase 25): can reveal health information (GDPR Art. 9), so stored only with
 * the `accessibility` consent ⚖️. Never used for ranking or as a filter by others, never sent to
 * an AI model; shown on the profile only when the member turns `show` on.
 */
export const accessNeeds = [
  'wheelchair',
  'step_free',
  'deaf_hoh',
  'blind_low_vision',
  'sign_language',
  'text_first',
  'quiet_places',
] as const;
export type AccessNeed = (typeof accessNeeds)[number];
export const accessNeedSchema = z.enum(accessNeeds);

export const accessNeedsSchema = z
  .object({
    needs: z
      .array(accessNeedSchema)
      .max(accessNeeds.length)
      .refine(unique, { message: 'Each need once' }),
    show: z.boolean(),
  })
  .strict();
export type AccessNeeds = z.infer<typeof accessNeedsSchema>;
export const noAccessNeeds: AccessNeeds = { needs: [], show: false };

/** Needs that make step-free places come first in the date planner. */
export const STEP_FREE_NEEDS: readonly AccessNeed[] = ['wheelchair', 'step_free'];

/** Version of the in-app text for the `accessibility` consent; bump it when the wording changes. */
export const ACCESSIBILITY_CONSENT_VERSION = '1';
