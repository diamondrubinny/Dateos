// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { AVAILABILITY_DAYS } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';

/**
 * Runs hourly: deletes "when I'm free" slots (phase 20) of closed chats, and lists not updated for
 * AVAILABILITY_DAYS (their slots have all passed by then).
 */
export async function processAvailability(
  db: Database,
  now = new Date(),
): Promise<{ deleted: number }> {
  const closed = await db.execute(sql`
    DELETE FROM match_availability a USING matches m
    WHERE m.id = a.match_id AND m.unmatched_at IS NOT NULL`);
  const old = await db.execute(sql`
    DELETE FROM match_availability
    WHERE updated_at < ${new Date(now.getTime() - AVAILABILITY_DAYS * 86_400_000)}`);
  return { deleted: (closed.rowCount ?? 0) + (old.rowCount ?? 0) };
}
