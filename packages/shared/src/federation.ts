// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { harmCategories, MAX_MESSAGE_LENGTH, scamSignals } from './chat.js';
import { MAX_REPORT_DETAILS, MAX_REPORT_EVIDENCE, reportCategories } from './moderation.js';
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
/** After a key rotation, the previous key may still sign the announcement this long (days). */
export const FEDERATION_PREVIOUS_KEY_DAYS = 7;

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
 * for our admin. `active`: both agreed. `suspended` (28d): our admin paused it; nothing crosses,
 * nothing is deleted. `ended`: either side ended it.
 */
export const partnerStatuses = [
  'invited_out',
  'invited_in',
  'active',
  'suspended',
  'ended',
] as const;
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
  /** 28d: reports our members sent to them, how many they reviewed, and reports from them. */
  reports: z.object({
    sent: z.number().int(),
    reviewed: z.number().int(),
    received: z.number().int(),
  }),
  /** 28d: messages waiting in the outbox for this partner. */
  outbox: z.number().int(),
});
export type Partner = z.infer<typeof partnerSchema>;

/**
 * Key rotation: the new key, signed (the request) with the key the partner knows, plus `proof`, a
 * signature with the new key over this community's origin and the new key, so only its holder can
 * announce it.
 */
export const federationKeyChangeSchema = z
  .object({
    publicKey: z.string().min(40).max(200),
    rotatedAt: z.iso.datetime(),
    proof: z.string().min(40).max(200),
  })
  .strict();
export type FederationKeyChange = z.infer<typeof federationKeyChangeSchema>;

export const partnersResponseSchema = z.object({
  /** `FEDERATION=on` and `INTEGRATIONS_KEY` set. */
  enabled: z.boolean(),
  /** Why it's off, for the dashboard. */
  reason: z.enum(['off', 'no_key']).nullable(),
  self: federationIdentitySchema.nullable(),
  /** When this community's key was last rotated, and how many partners still wait for it. */
  key: z.object({ rotatedAt: z.string().nullable(), waiting: z.number().int() }).nullable(),
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
  /** 28c: the latest message and how many arrived since the member last opened the chat. */
  lastMessage: z
    .object({ body: z.string(), mine: z.boolean(), hidden: z.boolean(), createdAt: z.string() })
    .nullable(),
  unread: z.number().int(),
});
export type FederatedMatch = z.infer<typeof federatedMatchSchema>;

// ---------------------------------------------------------------------------------------------
// 28c: text chat across communities. Each server keeps its own member's side of the conversation.
// ---------------------------------------------------------------------------------------------

/** A message as it crosses between servers. */
export const federatedWireMessageSchema = z
  .object({
    from: federationAliasSchema,
    to: federationAliasSchema,
    id: z.uuid(),
    body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  })
  .strict();
export type FederatedWireMessage = z.infer<typeof federatedWireMessageSchema>;

/** `delivered: false` means the match no longer exists on the receiving side. */
export const federatedDeliveryResponseSchema = z.object({ delivered: z.boolean() });

export const federatedMessageSchema = z.object({
  id: z.uuid(),
  mine: z.boolean(),
  body: z.string(),
  /** A hurtful message arrives hidden for the receiver ("show anyway"). */
  hidden: z.boolean(),
  harm: z.array(z.enum(harmCategories)),
  scam: z.array(z.enum(scamSignals)),
  createdAt: z.string(),
});
export type FederatedMessage = z.infer<typeof federatedMessageSchema>;

export const federatedMessagesPageSchema = z.object({
  messages: z.array(federatedMessageSchema),
  /** Cursor for older messages, or null at the start. */
  before: z.string().nullable(),
});
export type FederatedMessagesPage = z.infer<typeof federatedMessagesPageSchema>;

// ---------------------------------------------------------------------------------------------
// 28d: reports across communities, and their outcome (reviewed, never what was decided).
// ---------------------------------------------------------------------------------------------

export const federatedReportInputSchema = z
  .object({
    partnerId: z.uuid(),
    alias: federationAliasSchema,
    category: z.enum(reportCategories),
    details: z.string().trim().max(MAX_REPORT_DETAILS).optional(),
    /** Reporting blocks the person too, unless the reporter opts out. */
    block: z.boolean().default(true),
    /** The latest messages of the chat go with it as evidence, unless the reporter opts out. */
    attach: z.boolean().default(true),
  })
  .strict();
export type FederatedReportInput = z.input<typeof federatedReportInputSchema>;

/** A report as it crosses: evidence is the reporter's own chat with the person, copied by the server. */
export const federatedWireReportSchema = z
  .object({
    id: z.uuid(),
    from: federationAliasSchema,
    about: federationAliasSchema,
    category: z.enum(reportCategories),
    details: z.string().max(MAX_REPORT_DETAILS).nullable(),
    evidence: z
      .array(
        z.object({
          fromReported: z.boolean(),
          body: z.string().min(1).max(MAX_MESSAGE_LENGTH),
          sentAt: z.iso.datetime(),
        }),
      )
      .max(MAX_REPORT_EVIDENCE),
  })
  .strict();
export type FederatedWireReport = z.infer<typeof federatedWireReportSchema>;

export const federatedReportOutcomeSchema = z
  .object({ reportId: z.uuid(), outcome: z.literal('reviewed') })
  .strict();
