// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { matchModeSchema, publicTakeSchema } from './friends.js';
import { z } from 'zod';
import { genderSchema, intentionSchema, promptKeySchema, voicePromptSchema } from './profile.js';
import { aboutSchema, accessNeedSchema } from './about.js';
import { publicIdentitySchema } from './identity.js';
import { faithSchema } from './faith.js';
import { placeSchema } from './visibility.js';

/** Dimension of stored profile embeddings (hashing provider and 768-d Ollama models). */
export const EMBEDDING_DIM = 768;

export const interactionKinds = ['like', 'pass'] as const;
export const interactionKindSchema = z.enum(interactionKinds);
export type InteractionKind = z.infer<typeof interactionKindSchema>;

/** Max likes + passes per user per day (anti-bot). */
export const DAILY_INTERACTION_LIMIT = 300;
export const DAILY_PICKS_COUNT = 10;

/** Location grid cell size. Only the cell is stored, never the raw coordinates. */
export const LOCATION_CELL_KM = 1;

export const locationInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LocationInput = z.infer<typeof locationInputSchema>;

export const distanceBuckets = ['lt2', 'lt5', 'lt10', 'lt25', 'lt50', 'gt50'] as const;
export type DistanceBucket = (typeof distanceBuckets)[number];

export function distanceBucket(km: number): DistanceBucket {
  if (km < 2) return 'lt2';
  if (km < 5) return 'lt5';
  if (km < 10) return 'lt10';
  if (km < 25) return 'lt25';
  if (km < 50) return 'lt50';
  return 'gt50';
}

const KM_PER_DEG_LAT = 111.32;

/**
 * Snaps coordinates to the centre of a ~`cellKm` grid cell. Longitude steps widen with latitude
 * so cells stay roughly square. Everyone in a cell gets identical coordinates, which limits
 * trilateration attacks to cell precision.
 */
export function snapToGrid(lat: number, lng: number, cellKm = LOCATION_CELL_KM): LocationInput {
  const latStep = cellKm / KM_PER_DEG_LAT;
  const snappedLat = (Math.floor(lat / latStep) + 0.5) * latStep;
  const lngStep =
    cellKm / (KM_PER_DEG_LAT * Math.max(Math.cos((snappedLat * Math.PI) / 180), 0.01));
  let snappedLng = (Math.floor(lng / lngStep) + 0.5) * lngStep;
  if (snappedLng > 180) snappedLng -= 360;
  return {
    lat: Math.min(89.999, Math.max(-89.999, Number(snappedLat.toFixed(6)))),
    lng: Number(snappedLng.toFixed(6)),
  };
}

export const reasonCodes = [
  'same_intention',
  'shared_language',
  'nearby',
  'similar_vibe',
  'active_recently',
  'new_here',
  'shared_interests',
] as const;
export type ReasonCode = (typeof reasonCodes)[number];

export const publicPhotoSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Phase 40: what the photo shows, for screen readers (optional: older partner servers). */
  description: z.string().max(150).nullable().optional(),
  /**
   * Phase 66a: served blurred to this viewer (the owner blurs, or the community shows photos after a
   * match); its description is withheld.
   */
  blurred: z.boolean().optional(),
});

export const publicProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  intention: intentionSchema,
  bio: z.string().nullable(),
  languages: z.array(z.string()),
  prompts: z.array(z.object({ id: z.uuid(), promptKey: promptKeySchema, answer: z.string() })),
  photos: z.array(publicPhotoSchema),
  distance: z.enum(distanceBuckets).nullable(),
  /** Interests, lifestyle and the opening question (phase 19); null until filled in. */
  about: aboutSchema.nullable(),
  voicePrompt: voicePromptSchema.nullable(),
  /** Accessibility needs (phase 25), only those the member chose to show; usually empty. */
  accessNeeds: z.array(accessNeedSchema),
  /**
   * Gender identity and pronouns (phase 62a): only what the member shows to this viewer and the
   * community offers. Optional: partner cards never carry it.
   */
  identity: publicIdentitySchema.nullable().optional(),
  /**
   * Faith, stream and observance (phase 62b): only while the community's faith module is on.
   * Optional: partner cards never carry it.
   */
  faith: faithSchema.nullable().optional(),
  /** Opt-in badge: met someone from this community in person, both confirmed (phase 20). */
  metInPerson: z.boolean(),
  /** Opt-in badge: checked in at one of this community's events in the last year (phase 23). */
  atEvent: z.boolean(),
  /** Friends' takes (phase 22): approved by the profile owner, at most 3. */
  friendTakes: z.array(publicTakeSchema),
  /** Travel mode (phase 18c): shown as "Visiting {city}" instead of a distance. */
  visiting: placeSchema.nullable(),
  /** A moderator compared a live selfie with the photos. */
  verified: z.boolean(),
  reasons: z.array(z.enum(reasonCodes)),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

/**
 * Why others can't find me right now (phase 44). Each one alone keeps a profile out of new
 * people's decks; existing matches still see it.
 */
export const hiddenReasons = ['onBreak', 'incognito', 'noPhoto', 'noLocation'] as const;
export type HiddenReason = (typeof hiddenReasons)[number];

/** "See my profile as others do" (phase 44): exactly the card others get, plus what's missing. */
export const profilePreviewSchema = z.object({
  profile: publicProfileSchema,
  hidden: z.array(z.enum(hiddenReasons)),
  /** Photos still being checked: not shown to anyone yet. */
  pendingPhotos: z.number().int(),
});
export type ProfilePreview = z.infer<typeof profilePreviewSchema>;

export const discoverQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const interactionInputSchema = z
  .object({
    targetId: z.string().min(1).max(64),
    kind: interactionKindSchema,
    itemType: z.enum(['photo', 'prompt']).optional(),
    itemId: z.uuid().optional(),
    comment: z.string().trim().min(1).max(300).optional(),
    /** Friends mode (phase 22) has its own deck; a match needs both likes in the same mode. */
    mode: matchModeSchema.optional(),
  })
  .refine((v) => (v.itemType === undefined) === (v.itemId === undefined), {
    message: 'itemType and itemId go together',
    path: ['itemId'],
  })
  .refine((v) => v.kind === 'like' || (v.comment === undefined && v.itemId === undefined), {
    message: 'Only likes can carry a comment or item',
    path: ['kind'],
  });
export type InteractionInput = z.infer<typeof interactionInputSchema>;

export const interactionResultSchema = z.object({
  matched: z.boolean(),
  matchId: z.uuid().nullable(),
});

/** Undo a pass (phase 29b): only the latest one, only for this long. */
export const UNDO_PASS_MINUTES = 10;
export const undoPassResultSchema = z.object({
  profile: publicProfileSchema,
  mode: matchModeSchema,
});
export type UndoPassResult = z.infer<typeof undoPassResultSchema>;

export const likeReceivedSchema = z.object({
  profile: publicProfileSchema,
  comment: z.string().nullable(),
  itemType: z.enum(['photo', 'prompt']).nullable(),
  itemId: z.uuid().nullable(),
  /** Which of my prompts was liked, when the like was on a prompt. */
  promptKey: promptKeySchema.nullable(),
  createdAt: z.string(),
});
export type LikeReceived = z.infer<typeof likeReceivedSchema>;

export const matchSummarySchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  mode: matchModeSchema,
  profile: publicProfileSchema,
});
export type MatchSummary = z.infer<typeof matchSummarySchema>;

export const blockInputSchema = z.object({ userId: z.string().min(1).max(64) });

/** Someone I blocked (phase 35): the name only, never photos, newest first. */
export const blockedPersonSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  blockedAt: z.string(),
});
export type BlockedPerson = z.infer<typeof blockedPersonSchema>;

/** "Maybe later" (phase 33). */
export const MAX_SAVED_PROFILES = 30;
export const saveProfileInputSchema = z.object({ targetId: z.string().min(1).max(64) });
