// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Phase 69: a live check through the community's provider, compared with the member's first
 * profile photo. Only the result comes back (never a selfie or a face template) ⚖️. Signed like
 * the age check (phase 63). See docs/phases/PHASE-69.md.
 */
export const livenessResults = ['passed', 'failed', 'no_match'] as const;
export type LivenessResult = (typeof livenessResults)[number];

/** A session at the provider stays usable this long. */
export const LIVENESS_SESSION_MINUTES = 15;
/** How far the provider's timestamp may be from the server's clock. */
export const LIVENESS_MAX_SKEW_SECONDS = 300;

/** What the provider posts to `/v1/liveness/callback`, signed (see `livenessSigningString`). */
export const livenessCallbackSchema = z
  .object({
    session: z.uuid(),
    result: z.enum(livenessResults),
    method: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_.-]+$/),
    ts: z.number().int().positive(),
  })
  .strict();
export type LivenessCallback = z.infer<typeof livenessCallbackSchema>;

/**
 * The exact text the provider signs with HMAC-SHA256 and the shared secret, hex in the
 * `x-nexaheart-signature` header. The "liveness." prefix keeps it apart from age-check results.
 */
export function livenessSigningString(c: LivenessCallback): string {
  return `liveness.${c.session}.${c.result}.${c.method}.${c.ts}`;
}

export const livenessStateSchema = z.object({
  /** A provider is set up on this server. */
  available: z.boolean(),
  last: z
    .object({ result: z.enum(livenessResults), method: z.string(), checkedAt: z.string() })
    .nullable(),
});
export type LivenessState = z.infer<typeof livenessStateSchema>;
export const livenessStartSchema = z.object({ url: z.string() });

/** Phase 69: asking a match kindly to verify (once per chat), as the chat page shows it. */
export const verifyRequestStateSchema = z.object({
  /** I asked them already. */
  asked: z.boolean(),
  /** They asked me, and I'm not verified yet. */
  askedMe: z.boolean(),
  /** I may ask: they aren't verified and I haven't asked. */
  canAsk: z.boolean(),
});
export type VerifyRequestState = z.infer<typeof verifyRequestStateSchema>;
