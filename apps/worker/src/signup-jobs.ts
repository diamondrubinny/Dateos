// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { WAITLIST_RETENTION_DAYS } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';

/**
 * Runs daily (phase 21): deletes decided waitlist entries after WAITLIST_RETENTION_DAYS, and
 * sign-up permissions that expired unused.
 */
export async function processSignupRetention(
  db: Database,
  now = new Date(),
): Promise<{ waitlist: number; allowances: number }> {
  const cutoff = new Date(now.getTime() - WAITLIST_RETENTION_DAYS * 86_400_000);
  const waitlist = await db.execute(sql`
    DELETE FROM waitlist WHERE status <> 'pending' AND decided_at < ${cutoff}`);
  const allowances = await db.execute(sql`
    DELETE FROM signup_allowances WHERE expires_at < ${now}`);
  return { waitlist: waitlist.rowCount ?? 0, allowances: allowances.rowCount ?? 0 };
}
