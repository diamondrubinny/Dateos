// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { TRAVEL_RETENTION_DAYS } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';

/**
 * Runs hourly: deletes trips (travel mode, phase 18c) TRAVEL_RETENTION_DAYS after they ended.
 * Discovery doesn't wait for this: an ended trip already counts as over.
 */
export async function processTrips(
  db: Database,
  now = new Date(),
): Promise<{ tripsDeleted: number }> {
  const result = await db.execute(sql`
    UPDATE locations
    SET travel_city_id = NULL, travel_geo = NULL, travel_started_at = NULL, travel_until = NULL
    WHERE travel_until < ${new Date(now.getTime() - TRAVEL_RETENTION_DAYS * 86_400_000)}`);
  return { tripsDeleted: result.rowCount ?? 0 };
}
