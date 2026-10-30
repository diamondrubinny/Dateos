// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { OVERVIEW_DAYS, reportPriorities, type SafetyOverview } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';

type Count = { key: string | null; n: number };

/**
 * Dashboard → Overview (phase 36): how the moderation queue is doing, computed on request from
 * existing tables. Counts only: no names, ids or report text leave this function.
 */
export async function safetyOverview(db: Database): Promise<SafetyOverview> {
  const since = sql`now() - make_interval(days => ${OVERVIEW_DAYS})`;
  const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    (await db.execute<T>(query)).rows;
  const toRecord = (list: Count[]) =>
    Object.fromEntries(list.filter((r) => r.key !== null).map((r) => [r.key!, r.n]));

  const [
    byPriority,
    byCategory,
    oldest,
    received,
    reasons,
    resolved,
    accounts,
    suspensions,
    waiting,
    appeals,
  ] = await Promise.all([
    rows<Count>(sql`SELECT priority::text AS key, count(*)::int AS n FROM reports
        WHERE status = 'open' GROUP BY priority`),
    rows<Count>(sql`SELECT category::text AS key, count(*)::int AS n FROM reports
        WHERE status = 'open' GROUP BY category`),
    rows<{
      hours: number | null;
    }>(sql`SELECT floor(EXTRACT(EPOCH FROM now() - min(created_at)) / 3600)::int AS hours
        FROM reports WHERE status = 'open'`),
    rows<{ automatic: boolean; n: number }>(sql`SELECT automatic, count(*)::int AS n FROM reports
        WHERE created_at > ${since} GROUP BY automatic`),
    rows<Count>(sql`SELECT meta->>'reason' AS key, count(*)::int AS n FROM audit_logs
        WHERE action = 'report.automatic' AND created_at > ${since} GROUP BY 1`),
    rows<{ n: number; median: number | null }>(sql`SELECT count(*)::int AS n,
          floor(percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM resolved_at - created_at)) / 3600)::int AS median
        FROM reports WHERE status <> 'open' AND resolved_at > ${since}`),
    rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM "user" WHERE created_at > ${since}`),
    rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_logs
        WHERE action IN ('moderation.suspend', 'moderation.ban') AND created_at > ${since}`),
    rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM verifications WHERE status = 'pending'`),
    rows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM moderation_appeals WHERE status = 'open'`,
    ),
  ]);

  const priorities = toRecord(byPriority);
  return {
    open: {
      total: byPriority.reduce((sum, r) => sum + r.n, 0),
      byPriority: Object.fromEntries(
        reportPriorities.map((p) => [p, priorities[p] ?? 0]),
      ) as Record<(typeof reportPriorities)[number], number>,
      byCategory: toRecord(byCategory),
      oldestHours: oldest[0]?.hours ?? null,
    },
    recent: {
      days: OVERVIEW_DAYS,
      fromMembers: received.find((r) => !r.automatic)?.n ?? 0,
      automatic: received.find((r) => r.automatic)?.n ?? 0,
      automaticByReason: toRecord(reasons),
      resolved: resolved[0]?.n ?? 0,
      medianResolveHours: resolved[0]?.median ?? null,
      newAccounts: accounts[0]?.n ?? 0,
      suspensions: suspensions[0]?.n ?? 0,
    },
    verificationsWaiting: waiting[0]?.n ?? 0,
    appealsWaiting: appeals[0]?.n ?? 0,
  };
}
