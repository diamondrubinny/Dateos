// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { QueryConfig } from 'pg';
import { sql, type SQL } from 'drizzle-orm';

/**
 * The single source of truth for "may these two people see each other".
 * Both directions must hold: each person fits the other's gender, age, distance and
 * intention preferences. Blocks (either way) and past unmatches always hide.
 * Used by discovery, picks, profile views, photo access and interactions.
 */
export interface CandidateQuery {
  viewerId: string;
  today: string;
  /** Restrict to one user (visibility check for a specific profile). */
  targetId?: string;
  /** Hide people the viewer already liked or passed (feeds). */
  excludeDecided?: boolean;
  /** Hide these ids (e.g. today's picks in the discover feed). */
  excludeIds?: string[];
  limit?: number;
}

export interface CandidateRow {
  id: string;
  km: number;
  vibe: number | null;
  model: string | null;
  viewer_intention: string;
  candidate_intention: string;
  viewer_languages: string[];
  candidate_languages: string[];
  max_km: number;
  last_active_days: number | null;
  account_age_days: number;
  likes_30d: number;
  decisions_30d: number;
  liked_viewer: boolean;
  impressions_24h: number;
}

/**
 * Not taking a break (phase 18a). A break that has ended counts as over at once, before the worker
 * clears it. `alias` is a fixed table alias in our own SQL, never user input.
 */
export function notOnBreak(alias: 'u' | 'mu'): SQL {
  return sql.raw(`(${alias}.paused_at IS NULL OR ${alias}.paused_until <= now())`);
}

/** Both users are active and not separated by a block or an unmatch. */
export function notSeparated(a: SQL, b: SQL): SQL {
  return sql`NOT EXISTS (
      SELECT 1 FROM blocks bl
      WHERE (bl.blocker_id = ${a} AND bl.blocked_id = ${b}) OR (bl.blocker_id = ${b} AND bl.blocked_id = ${a})
    )
    AND NOT EXISTS (
      SELECT 1 FROM matches m
      WHERE m.unmatched_at IS NOT NULL
        AND ((m.user_a = ${a} AND m.user_b = ${b}) OR (m.user_a = ${b} AND m.user_b = ${a}))
    )`;
}

export function candidateSql(q: CandidateQuery): SQL {
  const today = sql`${q.today}::date`;
  return sql`
    WITH me AS (
      SELECT p.user_id, p.gender, p.interested_in, p.intention, p.languages,
             date_part('year', age(${today}, p.birth_date))::int AS age,
             pr.age_min, pr.age_max, pr.max_distance_km, pr.intentions AS wants,
             l.geo, e.embedding, e.model
      FROM profiles p
      -- A paused viewer (sensitive-data consent withdrawn) is not matched either way.
      JOIN "user" mu ON mu.id = p.user_id AND mu.status = 'active'
        -- ...and neither is a member taking a break.
        AND ${notOnBreak('mu')}
      JOIN preferences pr ON pr.user_id = p.user_id
      JOIN locations l ON l.user_id = p.user_id
      LEFT JOIN profile_embeddings e ON e.user_id = p.user_id
      WHERE p.user_id = ${q.viewerId}
    )
    SELECT
      c.user_id AS id,
      ST_Distance(me.geo, cl.geo) / 1000.0 AS km,
      CASE WHEN me.embedding IS NOT NULL AND ce.embedding IS NOT NULL AND me.model = ce.model
           THEN 1 - (me.embedding <=> ce.embedding) END AS vibe,
      ce.model,
      me.intention::text AS viewer_intention,
      c.intention::text AS candidate_intention,
      me.languages AS viewer_languages,
      c.languages AS candidate_languages,
      LEAST(me.max_distance_km, cpr.max_distance_km) AS max_km,
      (SELECT EXTRACT(EPOCH FROM (now() - max(s.updated_at))) / 86400 FROM session s WHERE s.user_id = c.user_id) AS last_active_days,
      EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400 AS account_age_days,
      (SELECT count(*) FILTER (WHERE i.kind = 'like') FROM interactions i
        WHERE i.actor_id = c.user_id AND i.created_at > now() - interval '30 days')::int AS likes_30d,
      (SELECT count(*) FROM interactions i
        WHERE i.actor_id = c.user_id AND i.created_at > now() - interval '30 days')::int AS decisions_30d,
      EXISTS (SELECT 1 FROM interactions i WHERE i.actor_id = c.user_id AND i.target_id = me.user_id AND i.kind = 'like') AS liked_viewer,
      (SELECT count(*) FROM impressions im WHERE im.candidate_id = c.user_id AND im.created_at > now() - interval '24 hours')::int AS impressions_24h
    FROM me
    JOIN profiles c ON c.user_id <> me.user_id
    JOIN "user" u ON u.id = c.user_id AND u.status = 'active' AND ${notOnBreak('u')}
    JOIN preferences cpr ON cpr.user_id = c.user_id
    JOIN locations cl ON cl.user_id = c.user_id
    LEFT JOIN profile_embeddings ce ON ce.user_id = c.user_id
    WHERE c.gender = ANY(me.interested_in)
      AND me.gender = ANY(c.interested_in)
      AND date_part('year', age(${today}, c.birth_date)) BETWEEN me.age_min AND me.age_max
      AND me.age BETWEEN cpr.age_min AND cpr.age_max
      AND ST_DWithin(me.geo, cl.geo, LEAST(me.max_distance_km, cpr.max_distance_km) * 1000.0)
      AND (cardinality(me.wants) = 0 OR c.intention = ANY(me.wants))
      AND (cardinality(cpr.intentions) = 0 OR me.intention = ANY(cpr.intentions))
      AND EXISTS (SELECT 1 FROM photos ph WHERE ph.user_id = c.user_id AND ph.status = 'clean' AND ph.purpose = 'profile')
      AND ${notSeparated(sql`me.user_id`, sql`c.user_id`)}
      -- Incognito (phase 18b): seen only by people they liked. Matches stay visible through canView.
      AND (NOT u.incognito OR EXISTS (
        SELECT 1 FROM interactions inc
        WHERE inc.actor_id = c.user_id AND inc.target_id = me.user_id AND inc.kind = 'like'))
      ${q.targetId ? sql`AND c.user_id = ${q.targetId}` : sql``}
      ${q.excludeDecided ? sql`AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.actor_id = me.user_id AND i.target_id = c.user_id)` : sql``}
      -- One array parameter keeps the statement text stable, so it can be prepared once.
      AND NOT (c.user_id = ANY(${sql.param(q.excludeIds ?? [])}::text[]))
    LIMIT ${q.limit ?? 300}`;
}

const dialect = new PgDialect();

/**
 * Runs the candidate query as a named prepared statement. The statement has many joins and
 * subqueries, and planning it took as long as running it (27 ms vs 42 ms with 5 000 members), so
 * each connection plans it once per query shape. Names are derived from the text, so a changed
 * query never reuses a stale statement.
 */
export async function queryCandidates(
  client: { query: (config: QueryConfig) => Promise<{ rows: unknown[] }> },
  q: CandidateQuery,
): Promise<CandidateRow[]> {
  const { sql: text, params } = dialect.sqlToQuery(candidateSql(q));
  const name = `candidates_${createHash('sha1').update(text).digest('hex').slice(0, 16)}`;
  const result = await client.query({ name, text, values: params });
  return result.rows as CandidateRow[];
}
