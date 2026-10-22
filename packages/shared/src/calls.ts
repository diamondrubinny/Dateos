// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/** Video dates (phase 15): 1:1 calls between matched members, through the community's LiveKit. */
export const callStatuses = ['ringing', 'active', 'ended', 'missed', 'declined'] as const;
export type CallStatus = (typeof callStatuses)[number];

/** An unanswered invitation becomes "Missed call" after this. */
export const CALL_RING_SECONDS = 45;
/** Join tokens are valid this long, for one room; the call itself can last longer. */
export const CALL_TOKEN_SECONDS = 120;
export const CALLS_PER_CHAT_PER_HOUR = 3;
export const CALLS_PER_MEMBER_PER_HOUR = 10;
/** After this many declined or missed invitations in a row, the caller waits for a message. */
export const CALL_REFUSALS_BEFORE_COOLDOWN = 2;
export const DEFAULT_CALL_MAX_MINUTES = 60;
export const MIN_CALL_MAX_MINUTES = 5;
export const MAX_CALL_MAX_MINUTES = 120;

export const startCallSchema = z.object({ video: z.boolean() });

/**
 * Joining (phase 16b): the device's X25519 public key for this call, base64url. It reaches the
 * other person inside their view of the call; the secret half never leaves the device.
 */
export const joinCallSchema = z.object({
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'An X25519 public key, base64url'),
});
export type StartCallInput = z.infer<typeof startCallSchema>;

/** A call as one participant sees it (in the chat line and the call screen). */
export const callSchema = z.object({
  id: z.uuid(),
  matchId: z.uuid(),
  status: z.enum(callStatuses),
  video: z.boolean(),
  /** True for the person who started the call. */
  mine: z.boolean(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** When an active call is ended by the community's time limit. */
  endsAt: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
});
export type CallView = z.infer<typeof callSchema>;

export const callJoinSchema = z.object({
  /** Public LiveKit address (wss://...). */
  url: z.string(),
  token: z.string(),
  /** The LiveKit room name (part of the end-to-end key derivation). */
  room: z.string(),
  call: callSchema,
});
export type CallJoin = z.infer<typeof callJoinSchema>;

/** Plain-text line for a call (report evidence, data export). */
export function callSummary(call: {
  video: boolean;
  status: CallStatus;
  durationSeconds: number | null;
}): string {
  const kind = call.video ? 'Video call' : 'Voice call';
  if (call.status === 'missed') return `${kind}: missed`;
  if (call.status === 'declined') return `${kind}: declined`;
  if (call.status === 'ringing') return `${kind}: ringing`;
  const minutes = Math.max(1, Math.round((call.durationSeconds ?? 0) / 60));
  return call.status === 'active' ? `${kind}: in progress` : `${kind}: ${minutes} min`;
}
