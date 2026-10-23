// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { publicPhotoSchema } from './discovery.js';
import {
  genderSchema,
  intentionSchema,
  MAX_AGE,
  MAX_PHOTOS,
  MAX_PROMPTS,
  MIN_AGE,
  promptKeySchema,
} from './profile.js';

/**
 * Communities that connect (phase 28): partnerships between two servers whose admins agreed, with
 * every server-to-server request signed (Ed25519). See docs/phases/PHASE-28.md.
 */
export const FEDERATION_VERSION = 1;
/** Where a server describes itself, relative to its API address. */
export const FEDERATION_WELL_KNOWN = '/.well-known/nexaheart';
/** Signed requests older or newer than this are refused. */
export const FEDERATION_MAX_SKEW_SECONDS = 300;
/** A nonce is remembered this long, so a captured request can't be replayed. */
export const FEDERATION_NONCE_SECONDS = 600;

export const FederationHeader = {
  Origin: 'x-nexaheart-origin',
  Date: 'x-nexaheart-date',
  Nonce: 'x-nexaheart-nonce',
  Signature: 'x-nexaheart-signature',
} as const;

/** What a server publishes about itself: public, no personal data beyond the contact address. */
export const federationIdentitySchema = z.object({
  version: z.literal(FEDERATION_VERSION),
  name: z.string().min(1).max(80),
  /** The API address (an origin). */
  url: z.url(),
  /** Ed25519, SPKI DER, base64. */
  publicKey: z.string().min(40).max(200),
  contact: z.string().max(200).nullable(),
  privacyUrl: z.url().nullable(),
});
export type FederationIdentity = z.infer<typeof federationIdentitySchema>;

/**
 * `invited_out`: we invited them, waiting for them to accept. `invited_in`: they invited us, waiting
 * for our admin. `active`: both agreed. `ended`: either side ended it.
 */
export const partnerStatuses = ['invited_out', 'invited_in', 'active', 'ended'] as const;
export type PartnerStatus = (typeof partnerStatuses)[number];

export const partnerSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  name: z.string(),
  contact: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  status: z.enum(partnerStatuses),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type Partner = z.infer<typeof partnerSchema>;

export const partnersResponseSchema = z.object({
  /** `FEDERATION=on` and `INTEGRATIONS_KEY` set. */
  enabled: z.boolean(),
  /** Why it's off, for the dashboard. */
  reason: z.enum(['off', 'no_key']).nullable(),
  self: federationIdentitySchema.nullable(),
  partners: z.array(partnerSchema),
});
export type PartnersResponse = z.infer<typeof partnersResponseSchema>;

/** Inviting needs the admin to confirm the data-sharing agreement is signed ⚖️. */
export const partnerInviteSchema = z
  .object({ url: z.url(), agreementConfirmed: z.literal(true) })
  .strict();
export const partnerAcceptSchema = z.object({ agreementConfirmed: z.literal(true) }).strict();

// ---------------------------------------------------------------------------------------------
// 28b: discovery and matching across communities. Only members who joined (the `federation`
// consent) take part; each is known to each partner by a random alias, never the real id.
// ---------------------------------------------------------------------------------------------

/** Version of the in-app text for the `federation` consent; bump it when the wording changes. */
export const FEDERATION_CONSENT_VERSION = '1';
/** Cards a partner returns per discovery request, at most. */
export const FEDERATED_DECK_SIZE = 20;
/** Aliases a discovery request may ask to leave out, at most. */
export const FEDERATED_EXCLUDE_MAX = 2000;

export const federationAliasSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** What a viewer's server sends with a discovery request: only what the filter needs. */
export const federatedViewerSchema = z
  .object({
    alias: federationAliasSchema,
    gender: genderSchema,
    interestedIn: z.array(genderSchema).min(1).max(8),
    age: z.number().int().min(MIN_AGE).max(MAX_AGE),
    ageMin: z.number().int().min(MIN_AGE).max(MAX_AGE),
    ageMax: z.number().int().min(MIN_AGE).max(MAX_AGE),
    intention: intentionSchema,
    /** Intentions wanted; empty means any. */
    wants: z.array(intentionSchema).max(8),
  })
  .strict();
export type FederatedViewer = z.infer<typeof federatedViewerSchema>;

export const federatedDiscoverRequestSchema = z
  .object({
    viewer: federatedViewerSchema,
    exclude: z.array(federationAliasSchema).max(FEDERATED_EXCLUDE_MAX),
  })
  .strict();
export type FederatedDiscoverRequest = z.infer<typeof federatedDiscoverRequestSchema>;

/** A member's card as it crosses to a partner. Never: email, location, religion, needs, voice. */
export const federatedCardSchema = z.object({
  alias: federationAliasSchema,
  displayName: z.string().min(1).max(40),
  age: z.number().int().min(MIN_AGE).max(MAX_AGE),
  gender: genderSchema,
  intention: intentionSchema,
  bio: z.string().max(500).nullable(),
  languages: z.array(z.string().max(12)).max(10),
  prompts: z
    .array(z.object({ promptKey: promptKeySchema, answer: z.string().max(300) }))
    .max(MAX_PROMPTS),
  photos: z
    .array(
      z.object({
        id: z.uuid(),
        width: z.number().int().positive().max(10_000).nullable(),
        height: z.number().int().positive().max(10_000).nullable(),
      }),
    )
    .min(1)
    .max(MAX_PHOTOS),
  verified: z.boolean(),
});
export type FederatedCard = z.infer<typeof federatedCardSchema>;

export const federatedDiscoverResponseSchema = z.object({
  cards: z.array(federatedCardSchema).max(FEDERATED_DECK_SIZE),
});

/** Who liked whom, and (for the match list) the liker's name and one photo. */
export const federatedLikeSchema = z
  .object({
    from: federationAliasSchema,
    to: federationAliasSchema,
    name: z.string().min(1).max(40),
    photoId: z.uuid(),
  })
  .strict();
export type FederatedLike = z.infer<typeof federatedLikeSchema>;

export const federatedLikeResponseSchema = z.object({
  matched: z.boolean(),
  /** On a match: the liked person's name and one photo. */
  name: z.string().min(1).max(40).nullable(),
  photoId: z.uuid().nullable(),
});

export const federatedPairSchema = z
  .object({ from: federationAliasSchema, to: federationAliasSchema })
  .strict();
export const federatedForgetSchema = z.object({ alias: federationAliasSchema }).strict();

// Members' API (on their own server).

export const federatedStatusSchema = z.object({
  /** Federation is on here and at least one partnership is active. */
  available: z.boolean(),
  /** This member joined (the `federation` consent). */
  joined: z.boolean(),
  consentVersion: z.string(),
  partners: z.array(
    z.object({ id: z.uuid(), name: z.string(), privacyUrl: z.string().nullable() }),
  ),
});
export type FederatedStatus = z.infer<typeof federatedStatusSchema>;

export const federatedJoinSchema = z.object({ version: z.string().min(1).max(32) }).strict();

/** A partner's member as shown in the app: the card plus where it comes from. */
export const federatedProfileSchema = z.object({
  partnerId: z.uuid(),
  community: z.string(),
  alias: federationAliasSchema,
  displayName: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  intention: intentionSchema,
  bio: z.string().nullable(),
  languages: z.array(z.string()),
  prompts: z.array(z.object({ promptKey: promptKeySchema, answer: z.string() })),
  photos: z.array(publicPhotoSchema),
  verified: z.boolean(),
});
export type FederatedProfile = z.infer<typeof federatedProfileSchema>;

export const federatedInteractionKinds = ['like', 'pass', 'block'] as const;
export const federatedInteractionSchema = z
  .object({
    partnerId: z.uuid(),
    alias: federationAliasSchema,
    kind: z.enum(federatedInteractionKinds),
  })
  .strict();
export type FederatedInteraction = z.infer<typeof federatedInteractionSchema>;

export const federatedMatchSchema = z.object({
  id: z.uuid(),
  partnerId: z.uuid(),
  community: z.string(),
  alias: federationAliasSchema,
  displayName: z.string(),
  photo: publicPhotoSchema.nullable(),
  createdAt: z.string(),
});
export type FederatedMatch = z.infer<typeof federatedMatchSchema>;
