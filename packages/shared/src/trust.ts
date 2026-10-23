// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Trust and safety (phase 21): hide me from my contacts, and who may open a new account
 * (open, invite code, or waitlist).
 */

// ---------------------------------------------------------------- email normalization

/**
 * Normalises an address so trivial variants match: case, surrounding spaces, "+tag" suffixes, and
 * dots in Gmail local parts. Used for bans, sign-up permissions and contact matching, on the server
 * and on the device alike.
 */
export function normalizeEmail(email: string): string {
  const [rawLocal = '', rawDomain = ''] = email.trim().toLowerCase().split('@');
  let local = rawLocal.split('+')[0]!;
  let domain = rawDomain;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replaceAll('.', '');
  return `${local}@${domain}`;
}

// ---------------------------------------------------------------- hide me from my contacts

export const MAX_CONTACT_HASHES = 2000;
/** SHA-256 (hex) of a normalized email address, computed on the device. */
export const contactHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const contactHidesInputSchema = z
  .object({ hashes: z.array(contactHashSchema).min(1).max(MAX_CONTACT_HASHES) })
  .strict();
export type ContactHidesInput = z.infer<typeof contactHidesInputSchema>;
export const contactHidesSchema = z.object({
  /** How many people are hidden both ways now (only members; nobody is told). */
  hidden: z.number().int(),
});
export type ContactHides = z.infer<typeof contactHidesSchema>;

// ---------------------------------------------------------------- sign-up mode

export const signupModes = ['open', 'invite', 'waitlist'] as const;
export type SignupMode = (typeof signupModes)[number];
export const signupModeSchema = z.object({ mode: z.enum(signupModes) });

/** Invite codes: 10 characters without look-alikes (no 0/O, 1/I/L). */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 10;
/** People type codes with spaces, dashes or in lower case. */
export const normalizeInviteCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** A redeemed code or an approved waitlist entry lets that email open an account for this long. */
export const SIGNUP_ALLOWANCE_DAYS = 7;
export const MEMBER_INVITES = 3;

export const redeemInviteSchema = z
  .object({
    code: z.string().trim().min(6).max(24),
    email: z.email().max(254),
  })
  .strict();
export type RedeemInviteInput = z.infer<typeof redeemInviteSchema>;

export const WAITLIST_NOTE_MAX = 200;
export const joinWaitlistSchema = z
  .object({
    email: z.email().max(254),
    note: z.string().trim().max(WAITLIST_NOTE_MAX).optional(),
  })
  .strict();
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

// ---------------------------------------------------------------- staff

export const createInviteSchema = z
  .object({
    label: z.string().trim().max(60).optional(),
    maxUses: z.number().int().min(1).max(1000),
    expiresInDays: z.number().int().min(1).max(365).nullable(),
  })
  .strict();
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const inviteSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  /** Only in the response that created it: codes are stored hashed. */
  code: z.string().optional(),
  maxUses: z.number().int(),
  uses: z.number().int(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** A member's personal invite (null for codes made in the dashboard). */
  byMember: z.boolean(),
  createdAt: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const waitlistStatuses = ['pending', 'approved', 'declined'] as const;
export type WaitlistStatus = (typeof waitlistStatuses)[number];
export const waitlistEntrySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  note: z.string().nullable(),
  status: z.enum(waitlistStatuses),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;
/** Waitlist entries are deleted this long after a decision. */
export const WAITLIST_RETENTION_DAYS = 90;
