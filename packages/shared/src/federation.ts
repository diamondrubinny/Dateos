// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

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
