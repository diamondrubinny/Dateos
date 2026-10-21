import { rank, scoreCandidate, type ScoreResult } from '@dateos/ai';
import { schema, type Database } from '@dateos/db';
import {
  ageOn,
  DAILY_INTERACTION_LIMIT,
  DAILY_PICKS_COUNT,
  distanceBucket,
  ErrorCode,
  snapToGrid,
  type InteractionInput,
  type Intention,
  type LikeReceived,
  type LocationInput,
  type MatchSummary,
  type PromptKey,
  type PublicProfile,
  type ReasonCode,
  type RealtimeEvent,
} from '@dateos/shared';
import type { Realtime } from '../../lib/realtime.js';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import { photoUrl } from '../me/service.js';
import { candidateSql, notSeparated, type CandidateRow } from './visibility.js';

const {
  profiles,
  prompts,
  photos,
  interactions,
  matches,
  blocks,
  dailyPicks,
  locations,
  consents,
  user,
} = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

interface Ranked {
  userId: string;
  km: number;
  /** Absent when a profile is shown outside discovery (likes, matches). */
  result?: ScoreResult | undefined;
}

export class DiscoveryService {
  constructor(
    private readonly db: Database,
    private readonly today: () => string,
    /** Real-time notifications (new match, closed chat). Optional for tests. */
    private readonly realtime?: Pick<Realtime, 'publish'>,
  ) {}

  private notify(userIds: string[], event: RealtimeEvent) {
    if (!this.realtime) return;
    for (const id of userIds) this.realtime.publish(id, event).catch(() => undefined);
  }

  // ---------------------------------------------------------------- location

  /** Raw coordinates are snapped here and never stored, logged or returned. */
  async setLocation(userId: string, input: LocationInput): Promise<void> {
    const [consent] = await this.db
      .select({ granted: consents.granted })
      .from(consents)
      .where(and(eq(consents.userId, userId), eq(consents.kind, 'location')))
      .orderBy(desc(consents.createdAt), desc(consents.id))
      .limit(1);
    if (!consent?.granted) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Location consent is required.');
    }
    const cell = snapToGrid(input.lat, input.lng);
    const point = sql`ST_SetSRID(ST_MakePoint(${cell.lng}, ${cell.lat}), 4326)::geography`;
    await this.db.execute(sql`
      INSERT INTO locations (user_id, geo, updated_at) VALUES (${userId}, ${point}, now())
      ON CONFLICT (user_id) DO UPDATE SET geo = ${point}, updated_at = now()`);
  }

  async clearLocation(userId: string): Promise<void> {
    await this.db.delete(locations).where(eq(locations.userId, userId));
  }

  // ---------------------------------------------------------------- ranking

  private async candidates(
    viewerId: string,
    options: { excludeIds?: string[]; targetId?: string; excludeDecided?: boolean },
  ) {
    const result = await this.db.execute<CandidateRow & Record<string, unknown>>(
      candidateSql({ viewerId, today: this.today(), ...options }),
    );
    return result.rows;
  }

  private score(rows: CandidateRow[]): (Ranked & { result: ScoreResult })[] {
    const scored = rows.map((row) => ({
      userId: row.id,
      km: Number(row.km),
      result: scoreCandidate({
        vibeCosine: row.vibe === null ? null : Number(row.vibe),
        embeddingModel: row.model,
        viewerIntention: row.viewer_intention as Intention,
        candidateIntention: row.candidate_intention as Intention,
        viewerLanguages: row.viewer_languages,
        candidateLanguages: row.candidate_languages,
        distanceKm: Number(row.km),
        maxDistanceKm: Number(row.max_km),
        lastActiveDays: row.last_active_days === null ? null : Number(row.last_active_days),
        accountAgeDays: Number(row.account_age_days),
        candidateLikes: row.likes_30d,
        candidateDecisions: row.decisions_30d,
        candidateLikedViewer: row.liked_viewer,
        impressions24h: row.impressions_24h,
      }),
    }));
    return rank(scored, this.today());
  }

  private async recordImpressions(viewerId: string, ids: string[], surface: 'discover' | 'picks') {
    if (ids.length === 0) return;
    // At most one impression per viewer, candidate and day, so reloading does not inflate counters.
    const idArray = sql`ARRAY[${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    await this.db.execute(sql`
      INSERT INTO impressions (viewer_id, candidate_id, surface)
      SELECT ${viewerId}, c.id, ${surface}::impression_surface
      FROM unnest(${idArray}) AS c(id)
      WHERE NOT EXISTS (
        SELECT 1 FROM impressions im
        WHERE im.viewer_id = ${viewerId} AND im.candidate_id = c.id AND im.created_at >= date_trunc('day', now())
      )`);
  }

  async discover(viewerId: string, limit: number): Promise<PublicProfile[]> {
    const picks = await this.db
      .select({ id: dailyPicks.candidateId })
      .from(dailyPicks)
      .where(and(eq(dailyPicks.userId, viewerId), eq(dailyPicks.servedOn, this.today())));
    const ranked = this.score(
      await this.candidates(viewerId, { excludeDecided: true, excludeIds: picks.map((p) => p.id) }),
    ).slice(0, limit);
    await this.recordImpressions(
      viewerId,
      ranked.map((r) => r.userId),
      'discover',
    );
    return this.toProfiles(viewerId, ranked);
  }

  /** Up to DAILY_PICKS_COUNT people, chosen once per day and kept stable for that day. */
  async picksToday(viewerId: string): Promise<PublicProfile[]> {
    const today = this.today();
    let stored = await this.db
      .select()
      .from(dailyPicks)
      .where(and(eq(dailyPicks.userId, viewerId), eq(dailyPicks.servedOn, today)))
      .orderBy(asc(dailyPicks.position));

    if (stored.length === 0) {
      const ranked = this.score(await this.candidates(viewerId, { excludeDecided: true })).slice(
        0,
        DAILY_PICKS_COUNT,
      );
      if (ranked.length > 0) {
        await this.db
          .insert(dailyPicks)
          .values(
            ranked.map((r, position) => ({
              userId: viewerId,
              candidateId: r.userId,
              servedOn: today,
              score: r.result.score,
              reasons: r.result.reasons,
              position,
            })),
          )
          .onConflictDoNothing();
        await this.recordImpressions(
          viewerId,
          ranked.map((r) => r.userId),
          'picks',
        );
      }
      stored = await this.db
        .select()
        .from(dailyPicks)
        .where(and(eq(dailyPicks.userId, viewerId), eq(dailyPicks.servedOn, today)))
        .orderBy(asc(dailyPicks.position));
    }

    // Re-check visibility now: someone may have blocked, changed preferences or been decided on.
    const stillVisible = new Map(
      (await this.candidates(viewerId, { excludeDecided: true })).map((row) => [
        row.id,
        Number(row.km),
      ]),
    );
    const visible = stored.filter((p) => stillVisible.has(p.candidateId));
    return this.toProfiles(
      viewerId,
      visible.map((p) => ({
        userId: p.candidateId,
        km: stillVisible.get(p.candidateId)!,
        result: {
          score: p.score,
          reasons: p.reasons as ReasonCode[],
          parts: {} as ScoreResult['parts'],
        },
      })),
    );
  }

  // ---------------------------------------------------------------- visibility

  /** True when the viewer may see the target's profile and photos. */
  async canView(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    const relation = await this.db.execute<{ ok: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM "user" u
        WHERE u.id = ${targetId} AND u.status = 'active'
          AND ${notSeparated(sql`${viewerId}`, sql`${targetId}`)}
          AND (
            EXISTS (SELECT 1 FROM interactions i WHERE i.actor_id = ${targetId} AND i.target_id = ${viewerId} AND i.kind = 'like')
            OR EXISTS (SELECT 1 FROM matches m WHERE m.unmatched_at IS NULL
                       AND ((m.user_a = ${viewerId} AND m.user_b = ${targetId}) OR (m.user_a = ${targetId} AND m.user_b = ${viewerId})))
          )
      ) AS ok`);
    if (relation.rows[0]?.ok) return true;
    return (await this.candidates(viewerId, { targetId })).length > 0;
  }

  async profile(viewerId: string, targetId: string): Promise<PublicProfile> {
    if (viewerId === targetId || !(await this.canView(viewerId, targetId))) throw notFound();
    const [row] = await this.candidates(viewerId, { targetId });
    const ranked = row
      ? this.score([row])[0]!
      : { userId: targetId, km: Number.NaN, result: undefined };
    const [profile] = await this.toProfiles(viewerId, [ranked]);
    if (!profile) throw notFound();
    return profile;
  }

  // ---------------------------------------------------------------- interactions

  async interact(
    actorId: string,
    input: InteractionInput,
  ): Promise<{ matched: boolean; matchId: string | null }> {
    if (input.targetId === actorId) throw notFound();
    if (!(await this.canView(actorId, input.targetId))) throw notFound();

    const [{ count }] = (
      await this.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM interactions
      WHERE actor_id = ${actorId} AND created_at >= date_trunc('day', now())`)
    ).rows as [{ count: number }];
    if (count >= DAILY_INTERACTION_LIMIT) {
      throw new HttpError(429, ErrorCode.RateLimited, 'Daily limit reached. Come back tomorrow.');
    }

    if (input.itemType && input.itemId) {
      const table = input.itemType === 'photo' ? photos : prompts;
      const conditions = [eq(table.id, input.itemId), eq(table.userId, input.targetId)];
      if (input.itemType === 'photo') {
        conditions.push(eq(photos.status, 'clean'), eq(photos.purpose, 'profile'));
      }
      const [item] = await this.db
        .select({ id: table.id })
        .from(table)
        .where(and(...conditions));
      if (!item)
        throw new HttpError(
          400,
          ErrorCode.ValidationError,
          'That photo or prompt is not on this profile.',
        );
    }

    const result = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(interactions)
        .values({
          actorId,
          targetId: input.targetId,
          kind: input.kind,
          itemType: input.itemType ?? null,
          itemId: input.itemId ?? null,
          comment: input.comment ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: interactions.id });
      if (inserted.length === 0)
        throw new HttpError(409, ErrorCode.Conflict, 'You already decided on this profile.');
      if (input.kind !== 'like') return { matched: false, matchId: null };

      const [reverse] = await tx
        .select({ id: interactions.id })
        .from(interactions)
        .where(
          and(
            eq(interactions.actorId, input.targetId),
            eq(interactions.targetId, actorId),
            eq(interactions.kind, 'like'),
          ),
        );
      if (!reverse) return { matched: false, matchId: null };

      const [a, b] = [actorId, input.targetId].sort() as [string, string];
      await tx.insert(matches).values({ userA: a, userB: b }).onConflictDoNothing();
      const [match] = await tx
        .select({ id: matches.id })
        .from(matches)
        .where(and(eq(matches.userA, a), eq(matches.userB, b)));
      return { matched: true, matchId: match!.id };
    });
    if (result.matchId)
      this.notify([input.targetId], { type: 'match.new', matchId: result.matchId });
    return result;
  }

  /** Everyone who liked me and is still waiting for my answer. Free for every user. */
  async likesReceived(viewerId: string): Promise<LikeReceived[]> {
    const rows = await this.db.execute<{
      actor_id: string;
      comment: string | null;
      item_type: 'photo' | 'prompt' | null;
      item_id: string | null;
      prompt_key: PromptKey | null;
      created_at: Date;
    }>(sql`
      SELECT i.actor_id, i.comment, i.item_type, i.item_id, p.prompt_key, i.created_at
      FROM interactions i
      JOIN "user" u ON u.id = i.actor_id AND u.status = 'active'
      LEFT JOIN prompts p ON i.item_type = 'prompt' AND p.id = i.item_id AND p.user_id = ${viewerId}
      WHERE i.target_id = ${viewerId} AND i.kind = 'like'
        AND NOT EXISTS (SELECT 1 FROM interactions mine WHERE mine.actor_id = ${viewerId} AND mine.target_id = i.actor_id)
        AND ${notSeparated(sql`${viewerId}`, sql`i.actor_id`)}
      ORDER BY i.created_at DESC
      LIMIT 100`);
    const profilesById = new Map(
      (
        await this.toProfiles(
          viewerId,
          rows.rows.map((r) => ({
            userId: r.actor_id,
            km: Number.NaN,
            result: undefined,
          })) satisfies Ranked[],
        )
      ).map((p) => [p.id, p]),
    );
    return rows.rows.flatMap((r) => {
      const profile = profilesById.get(r.actor_id);
      return profile
        ? [
            {
              profile,
              comment: r.comment,
              itemType: r.item_type,
              itemId: r.item_id,
              promptKey: r.prompt_key,
              createdAt: new Date(r.created_at).toISOString(),
            },
          ]
        : [];
    });
  }

  async matches(viewerId: string): Promise<MatchSummary[]> {
    const rows = await this.db
      .select({
        id: matches.id,
        userA: matches.userA,
        userB: matches.userB,
        createdAt: matches.createdAt,
      })
      .from(matches)
      .where(
        and(
          or(eq(matches.userA, viewerId), eq(matches.userB, viewerId)),
          isNull(matches.unmatchedAt),
        ),
      )
      .orderBy(desc(matches.createdAt));
    const others = rows.map((r) => (r.userA === viewerId ? r.userB : r.userA));
    const visible = new Set<string>();
    for (const id of others) if (await this.canView(viewerId, id)) visible.add(id);
    const profilesById = new Map(
      (
        await this.toProfiles(
          viewerId,
          [...visible].map((userId) => ({
            userId,
            km: Number.NaN,
            result: undefined,
          })) satisfies Ranked[],
        )
      ).map((p) => [p.id, p]),
    );
    return rows.flatMap((r) => {
      const profile = profilesById.get(r.userA === viewerId ? r.userB : r.userA);
      return profile ? [{ id: r.id, createdAt: r.createdAt.toISOString(), profile }] : [];
    });
  }

  async unmatch(viewerId: string, matchId: string): Promise<void> {
    const updated = await this.db
      .update(matches)
      .set({ unmatchedAt: new Date(), unmatchedBy: viewerId })
      .where(
        and(
          eq(matches.id, matchId),
          or(eq(matches.userA, viewerId), eq(matches.userB, viewerId)),
          isNull(matches.unmatchedAt),
        ),
      )
      .returning({ id: matches.id, userA: matches.userA, userB: matches.userB });
    if (updated.length === 0) throw notFound();
    this.notify([updated[0]!.userA, updated[0]!.userB], { type: 'match.closed', matchId });
  }

  /** Always succeeds for well-formed ids, so blocking cannot be used to probe which accounts exist. */
  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) return;
    const closed = await this.db.transaction(async (tx) => {
      const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.id, blockedId));
      if (!target) return [];
      await tx.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing();
      const [a, b] = [blockerId, blockedId].sort() as [string, string];
      const ended = await tx
        .update(matches)
        .set({ unmatchedAt: new Date(), unmatchedBy: blockerId })
        .where(and(eq(matches.userA, a), eq(matches.userB, b), isNull(matches.unmatchedAt)))
        .returning({ id: matches.id });
      await audit(tx, {
        actorId: blockerId,
        action: 'user.blocked',
        targetType: 'user',
        targetId: blockedId,
      });
      return ended;
    });
    for (const m of closed)
      this.notify([blockerId, blockedId], { type: 'match.closed', matchId: m.id });
  }

  /**
   * Whether the reporter has had any contact with the target: can see them now, matched at
   * some point, or received a like from them. Reports outside this are treated as not found,
   * so reporting cannot be used to probe accounts.
   */
  async hasContact(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return false;
    if (await this.canView(viewerId, targetId)) return true;
    const result = await this.db.execute<{ ok: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM matches m
        WHERE (m.user_a = ${viewerId} AND m.user_b = ${targetId}) OR (m.user_a = ${targetId} AND m.user_b = ${viewerId})
      ) OR EXISTS (
        SELECT 1 FROM interactions i WHERE i.actor_id = ${targetId} AND i.target_id = ${viewerId}
      ) AS ok`);
    return Boolean(result.rows[0]?.ok);
  }

  /** Ends every active match of a member (suspension) and tells both sides. */
  async closeAllMatches(userId: string): Promise<void> {
    const ended = await this.db
      .update(matches)
      .set({ unmatchedAt: new Date(), unmatchedBy: null })
      .where(
        and(or(eq(matches.userA, userId), eq(matches.userB, userId)), isNull(matches.unmatchedAt)),
      )
      .returning({ id: matches.id, userA: matches.userA, userB: matches.userB });
    for (const m of ended) this.notify([m.userA, m.userB], { type: 'match.closed', matchId: m.id });
  }

  // ---------------------------------------------------------------- presentation

  private async toProfiles(viewerId: string, items: Ranked[]): Promise<PublicProfile[]> {
    if (items.length === 0) return [];
    const ids = items.map((i) => i.userId);
    const today = this.today();
    const profileRows = await this.db.select().from(profiles).where(inArray(profiles.userId, ids));
    const promptRows = await this.db
      .select({
        id: prompts.id,
        userId: prompts.userId,
        promptKey: prompts.promptKey,
        answer: prompts.answer,
      })
      .from(prompts)
      .where(inArray(prompts.userId, ids))
      .orderBy(asc(prompts.position));
    const photoRows = await this.db
      .select({ id: photos.id, userId: photos.userId, width: photos.width, height: photos.height })
      .from(photos)
      .where(
        and(inArray(photos.userId, ids), eq(photos.status, 'clean'), eq(photos.purpose, 'profile')),
      )
      .orderBy(asc(photos.position), asc(photos.createdAt));
    const byId = new Map(profileRows.map((p) => [p.userId, p]));

    return items.flatMap((item) => {
      const p = byId.get(item.userId);
      if (!p || item.userId === viewerId) return [];
      return [
        {
          id: p.userId,
          displayName: p.displayName,
          age: ageOn(p.birthDate, today),
          gender: p.gender,
          intention: p.intention,
          bio: p.bio,
          languages: p.languages,
          prompts: promptRows
            .filter((r) => r.userId === p.userId)
            .map(({ id, promptKey, answer }) => ({ id, promptKey, answer })),
          photos: photoRows
            .filter((r) => r.userId === p.userId)
            .map(({ id, width, height }) => ({ id, url: photoUrl(id), width, height })),
          distance: Number.isFinite(item.km) ? distanceBucket(item.km) : null,
          verified: p.verifiedAt !== null,
          reasons: item.result?.reasons ?? [],
        },
      ];
    });
  }
}
