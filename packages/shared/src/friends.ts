// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
// profile.ts must not import this file (a cycle would leave these undefined at load time).
import { genderSchema, genders, MAX_AGE, MIN_AGE } from './profile.js';

/**
 * Friends (phase 22): friends mode (a separate deck for friendship), friends' takes on a profile,
 * and double dates (two pairs of friends, a group chat of four).
 */

// ---------------------------------------------------------------- friends mode

/** Every like, match and chat belongs to one mode; a match needs both likes in the same mode. */
export const matchModes = ['date', 'friend'] as const;
export type MatchMode = (typeof matchModes)[number];
export const matchModeSchema = z.enum(matchModes);

export const friendModeSchema = z
  .object({
    on: z.boolean(),
    ageMin: z.number().int().min(MIN_AGE).max(MAX_AGE),
    ageMax: z.number().int().min(MIN_AGE).max(MAX_AGE),
    /** Empty means anyone. */
    genders: z
      .array(genderSchema)
      .max(genders.length)
      .refine((g) => new Set(g).size === g.length, { message: 'Each gender once' }),
  })
  .strict()
  .refine((f) => f.ageMin <= f.ageMax, { message: 'ageMin must be <= ageMax', path: ['ageMin'] });
export type FriendMode = z.infer<typeof friendModeSchema>;
export const defaultFriendMode: FriendMode = {
  on: false,
  ageMin: MIN_AGE,
  ageMax: MAX_AGE,
  genders: [],
};

// ---------------------------------------------------------------- friends' takes

export const takeRelations = ['friend', 'family', 'colleague', 'other'] as const;
export type TakeRelation = (typeof takeRelations)[number];
export const TAKE_NAME_MAX = 40;
export const TAKE_TEXT_MAX = 200;
export const MAX_SHOWN_TAKES = 3;
/** Pending and approved together, so a member can't be flooded. */
export const MAX_TAKES = 10;
export const TAKE_LINK_DAYS = 7;

export const takeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);
export const takeLinkSchema = z.object({ token: z.string(), expiresAt: z.string() });
export const takeLinkInfoSchema = z.object({ name: z.string() });
export const writeTakeSchema = z
  .object({
    name: z.string().trim().min(1).max(TAKE_NAME_MAX),
    relation: z.enum(takeRelations),
    text: z.string().trim().min(10).max(TAKE_TEXT_MAX),
  })
  .strict();
export type WriteTakeInput = z.infer<typeof writeTakeSchema>;
export const takeStatuses = ['pending', 'approved'] as const;
export const friendTakeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  relation: z.enum(takeRelations),
  text: z.string(),
  status: z.enum(takeStatuses),
  createdAt: z.string(),
});
export type FriendTake = z.infer<typeof friendTakeSchema>;
/** On a public profile: approved takes only, without ids or dates. */
export const publicTakeSchema = friendTakeSchema.pick({ name: true, relation: true, text: true });
export type PublicTake = z.infer<typeof publicTakeSchema>;

// ---------------------------------------------------------------- double dates

export const PAIR_LINK_DAYS = 7;
export const DOUBLE_MESSAGE_MAX = 1000;

const pairMemberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  age: z.number().int(),
  photoUrl: z.string().nullable(),
});
export type PairMember = z.infer<typeof pairMemberSchema>;
export const myPairSchema = z.object({
  id: z.uuid(),
  friend: pairMemberSchema,
  createdAt: z.string(),
});
export type MyPair = z.infer<typeof myPairSchema>;
export const pairInviteSchema = z.object({ token: z.string(), expiresAt: z.string() });
export const pairCardSchema = z.object({
  id: z.uuid(),
  members: z.array(pairMemberSchema).length(2),
});
export type PairCard = z.infer<typeof pairCardSchema>;
export const pairDecisionSchema = z.object({
  doubleId: z.uuid().nullable(),
});
export const doubleMessageSchema = z.object({
  id: z.uuid(),
  senderId: z.string(),
  mine: z.boolean(),
  text: z.string(),
  /** Hidden for the reader: the harm filter flagged it (they can still reveal it). */
  hidden: z.boolean(),
  createdAt: z.string(),
});
export type DoubleMessage = z.infer<typeof doubleMessageSchema>;
export const doubleSchema = z.object({
  id: z.uuid(),
  /** The other three, mine first in the pair order. */
  members: z.array(pairMemberSchema),
  closed: z.boolean(),
  lastMessage: doubleMessageSchema.nullable(),
  createdAt: z.string(),
});
export type DoubleChat = z.infer<typeof doubleSchema>;
export const sendDoubleMessageSchema = z
  .object({
    text: z.string().trim().min(1).max(DOUBLE_MESSAGE_MAX),
    clientId: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[\w-]+$/),
  })
  .strict();
