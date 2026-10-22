// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/**
 * Who sees me, and when (phase 18). "Take a break" hides a member from new people for a while;
 * existing matches and chats carry on, so a break never ghosts anyone.
 */
export const pauseDurations = ['24h', '3d', '7d', 'indefinite'] as const;
export type PauseDuration = (typeof pauseDurations)[number];

const PAUSE_HOURS: Record<Exclude<PauseDuration, 'indefinite'>, number> = {
  '24h': 24,
  '3d': 72,
  '7d': 168,
};

export const pauseInputSchema = z.object({ duration: z.enum(pauseDurations) });
export type PauseInput = z.infer<typeof pauseInputSchema>;

/** When a break chosen now ends by itself, or null for "until I turn it back on". */
export function pauseEndsAt(duration: PauseDuration, now: Date): Date | null {
  return duration === 'indefinite'
    ? null
    : new Date(now.getTime() + PAUSE_HOURS[duration] * 3_600_000);
}

/** null: not on a break. `until` null: until the member turns it back on. */
export const pauseStateSchema = z
  .object({ since: z.string(), until: z.string().nullable() })
  .nullable();
export type PauseState = z.infer<typeof pauseStateSchema>;

/** The worker checks for ended breaks this often (the API already treats them as over). */
export const PAUSE_SWEEP_SECONDS = 300;
