// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Phase 63: age assurance through a provider the community chooses. The app sends the member to
 * the provider with a one-time session; the provider sends back only the result, signed with a
 * shared secret. Nothing the member showed the provider is kept here ⚖️ 📘.
 */
export const ageCheckResults = ['over_18', 'under_18', 'failed'] as const;
export type AgeCheckResult = (typeof ageCheckResults)[number];

/** How long a session at the provider stays valid. */
export const AGE_CHECK_SESSION_MINUTES = 15;
/** How old a provider's signed result may be. */
export const AGE_CHECK_MAX_SKEW_SECONDS = 300;

/** What the provider posts to `/v1/age-check/callback` (signed, see `ageCheckSigningString`). */
export const ageCheckCallbackSchema = z
  .object({
    session: z.uuid(),
    result: z.enum(ageCheckResults),
    /** The provider's own name for how it checked (e.g. "eudi_wallet", "face_estimation"). */
    method: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_.-]+$/),
    /** Unix time (seconds) when the provider signed it. */
    ts: z.number().int().positive(),
  })
  .strict();
export type AgeCheckCallback = z.infer<typeof ageCheckCallbackSchema>;

/**
 * The exact text the provider signs with HMAC-SHA256 and the shared secret, sent hex-encoded in the
 * `x-nexaheart-signature` header. Fields joined with "." in this order.
 */
export function ageCheckSigningString(c: AgeCheckCallback): string {
  return `${c.session}.${c.result}.${c.method}.${c.ts}`;
}

export const ageCheckStateSchema = z.object({
  /** The community requires it and a provider is configured. */
  required: z.boolean(),
  status: z.enum(['none', 'passed', 'failed']),
  checkedAt: z.string().nullable(),
});
export type AgeCheckState = z.infer<typeof ageCheckStateSchema>;

export const ageCheckStartSchema = z.object({ url: z.string() });
