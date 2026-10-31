// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { currentRest } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';

type Row = {
  user_id: string;
  candles: number;
  second_day: boolean;
  time_zone: string | null;
  lat: number | null;
  lng: number | null;
};

/** Members in Shabbat mode (`userId`, or those with something held), with their place. */
async function rows(db: Pick<Database, 'execute'>, only: { userId?: string; held?: true }) {
  const { rows } = await db.execute<Row>(sql`
    SELECT p.user_id, p.shabbat_candles AS candles, p.shabbat_second_day AS second_day,
           p.shabbat_time_zone AS time_zone,
           ST_Y(x.g::geometry) AS lat, ST_X(x.g::geometry) AS lng
    FROM preferences p
    LEFT JOIN locations l ON l.user_id = p.user_id
    LEFT JOIN LATERAL (SELECT CASE
        WHEN l.travel_geo IS NOT NULL AND l.travel_until > now() THEN l.travel_geo
        ELSE l.geo END AS g) x ON true
    WHERE p.shabbat_mode
      ${only.userId ? sql`AND p.user_id = ${only.userId}` : sql``}
      ${only.held ? sql`AND p.shabbat_held` : sql``}
    LIMIT 1000`);
  return rows;
}

const isResting = (r: Row, at: number) =>
  r.lat !== null &&
  r.lng !== null &&
  currentRest(at, r.lat, r.lng, r.time_zone, { candles: r.candles, secondDay: r.second_day }) !==
    null;

/** Phase 74a: whether the member is keeping Shabbat or a holiday right now (by their place). */
export async function resting(
  db: Pick<Database, 'execute'>,
  userId: string,
  at = Date.now(),
): Promise<boolean> {
  const [row] = await rows(db, { userId });
  return row ? isResting(row, at) : false;
}

/**
 * Phase 74a: after nightfall, one notification to each member for whom something came in during
 * the rest (every few minutes; the rest ends at a different time in each place).
 */
export async function releaseRests(
  db: Pick<Database, 'execute'>,
  notify: (userId: string) => Promise<void>,
  at = Date.now(),
): Promise<{ released: number }> {
  let released = 0;
  for (const r of await rows(db, { held: true })) {
    if (isResting(r, at)) continue;
    await db.execute(sql`UPDATE preferences SET shabbat_held = false WHERE user_id = ${r.user_id}`);
    await notify(r.user_id);
    released += 1;
  }
  return { released };
}
