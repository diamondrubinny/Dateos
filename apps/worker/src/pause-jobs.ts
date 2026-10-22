// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { sql } from 'drizzle-orm';

export interface PauseJobContext {
  db: Database;
  /** A content-free push: "your profile is visible again" (best effort). */
  tellVisible: (userId: string) => Promise<void>;
  now?: () => Date;
}

/**
 * Runs every PAUSE_SWEEP_SECONDS: clears breaks that have ended ("Take a break", phase 18a) and
 * tells each member once. Visibility doesn't wait for this: the API treats an ended break as over.
 */
export async function processPauses(ctx: PauseJobContext): Promise<{ ended: number }> {
  const now = ctx.now?.() ?? new Date();
  const ended = await ctx.db.execute<{ id: string }>(sql`
    UPDATE "user" SET paused_at = NULL, paused_until = NULL
    WHERE paused_until IS NOT NULL AND paused_until <= ${now}
    RETURNING id`);
  for (const row of ended.rows) await ctx.tellVisible(row.id).catch(() => undefined);
  return { ended: ended.rows.length };
}
