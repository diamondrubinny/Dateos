// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm, rank, scoreCandidate, type ScoreResult } from '@nexaheart/ai';
import type { Pool } from 'pg';
import { schema, type Database } from '@nexaheart/db';
import {
  ageOn,
  DAILY_INTERACTION_LIMIT,
  EVENT_BADGE_MONTHS,
  DAILY_PICKS_COUNT,
  distanceBucket,
  ErrorCode,
  snapToGrid,
  type About,
  type AccessNeed,
  type InteractionInput,
  type Intention,
  type LikeReceived,
  type LocationInput,
  type MatchSummary,
  type PromptKey,
  type PublicProfile,
  type ReasonCode,
  type RealtimeEvent,
  CLOSED_CARD_DAYS,
  type ClosedConversation,
  YOUR_TURN_LIMIT,
  UNDO_PASS_MINUTES,
  type UndoPassResult,
  type MatchMode,
  MAX_SHOWN_TAKES,
  type PublicTake,
  type TakeRelation,
} from '@nexaheart/shared';
import type { Realtime } from '../../lib/realtime.js';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import { photoUrl } from '../me/service.js';
import type { CityIndex } from '../places/cities.js';
import {
  notContactHidden,
  notOnBreak,
  notSeparated,
  queryCandidates,
  type CandidateRow,
} from './visibility.js';
import type { AppEvents } from '../../lib/app-events.js';
import { noEvents } from '../../lib/app-events.js';

const {
  profiles,
  prompts,
  photos,
  interactions,
  matches,
  blocks,
  dailyPicks,
  locations,
  profileAbout,
  preferences,
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
    /** Push notification for the person who was liked back (content-free). */
    private readonly onMatch?: (userId: string, matchId: string) => Promise<void>,
    /** Names of the cities travellers visit (phase 18c). */
    private readonly cities?: CityIndex,
  ) {}

  /** Integrations listen here (phase 24). */
  appEvents: AppEvents = noEvents;

  private closedListeners: ((matchId: string) => Promise<void>)[] = [];

  /** Runs when a match ends for any reason (unmatch, block, suspension): calls are hung up. */
  onMatchClosed(listener: (matchId: string) => Promise<void>): void {
    this.closedListeners.push(listener);
  }

  private separationListeners: ((a: string, b: string | null) => Promise<void>)[] = [];

  /**
   * Runs after a block (both ids) or when an account loses access (one id, the other null), so
   * group features can close too (phase 22: double dates and pairs).
   */
  onSeparation(listener: (a: string, b: string | null) => Promise<void>): void {
    this.separationListeners.push(listener);
  }

  private separated(a: string, b: string | null) {
    for (const listener of this.separationListeners) listener(a, b).catch(() => undefined);
  }

  private notify(userIds: string[], event: RealtimeEvent) {
    if (event.type === 'match.closed') {
      for (const listener of this.closedListeners) listener(event.matchId).catch(() => undefined);
    }
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
    options: {
      excludeIds?: string[];
      targetId?: string;
      excludeDecided?: boolean;
      mode?: MatchMode;
      onlyIds?: string[];
    },
  ) {
    // drizzle's node-postgres database exposes its pool as $client.
    const pool = (this.db as unknown as { $client: Pool }).$client;
    return queryCandidates(pool, { viewerId, today: this.today(), ...options });
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
        sharedInterests: row.shared_interests,
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

  /** Dating candidates of a member (phase 22: double dates intersect two of these lists). */
  async candidateIds(viewerId: string): Promise<Set<string>> {
    return new Set((await this.candidates(viewerId, {})).map((r) => r.id));
  }

  /** Whether the viewer may see the target as a dating candidate (both ways, every rule). */
  async isCandidate(viewerId: string, targetId: string): Promise<boolean> {
    return (await this.candidates(viewerId, { targetId })).length > 0;
  }

  /**
   * Speed dating (phase 23): who this member could be paired with, under every dating rule both
   * ways, leaving out people either of them already decided on.
   */
  async speedPartners(viewerId: string, among: string[]): Promise<Set<string>> {
    if (among.length === 0) return new Set();
    const rows = await this.candidates(viewerId, { excludeDecided: true, onlyIds: among });
    return new Set(rows.map((r) => r.id));
  }

  /**
   * A mutual yes after a speed date (phase 23): both likes are recorded and a dating match opens,
   * as if each had liked the other's profile. Returns the match.
   */
  async matchFromSpeedDate(a: string, b: string): Promise<string> {
    const matchId = await this.db.transaction(async (tx) => {
      await tx
        .insert(interactions)
        .values([
          { actorId: a, targetId: b, kind: 'like', mode: 'date' },
          { actorId: b, targetId: a, kind: 'like', mode: 'date' },
        ])
        .onConflictDoNothing();
      const [userA, userB] = [a, b].sort() as [string, string];
      await tx.insert(matches).values({ userA, userB, mode: 'date' }).onConflictDoNothing();
      const [match] = await tx
        .select({ id: matches.id })
        .from(matches)
        .where(and(eq(matches.userA, userA), eq(matches.userB, userB)));
      return match!.id;
    });
    this.notify([a, b], { type: 'match.new', matchId });
    for (const id of [a, b]) this.onMatch?.(id, matchId).catch(() => undefined);
    this.appEvents.emit({ type: 'match.created', matchId });
    return matchId;
  }

  /** Friends mode (phase 22): its own deck, only people who turned friends mode on too. */
  async discoverFriends(viewerId: string, limit: number): Promise<PublicProfile[]> {
    if (!(await this.friendModeOn(viewerId))) return [];
    const ranked = this.score(
      await this.candidates(viewerId, { excludeDecided: true, mode: 'friend' }),
    ).slice(0, limit);
    return this.toProfiles(viewerId, ranked);
  }

  private async friendModeOn(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ on: preferences.friendMode })
      .from(preferences)
      .where(eq(preferences.userId, userId));
    return Boolean(row?.on);
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
            -- Someone who liked me, unless they're taking a break; a match always stays visible.
            (EXISTS (SELECT 1 FROM interactions i WHERE i.actor_id = ${targetId} AND i.target_id = ${viewerId} AND i.kind = 'like')
             AND ${notOnBreak('u')} AND ${notContactHidden(sql`${viewerId}`, sql`${targetId}`)})
            OR EXISTS (SELECT 1 FROM matches m WHERE m.unmatched_at IS NULL
                       AND ((m.user_a = ${viewerId} AND m.user_b = ${targetId}) OR (m.user_a = ${targetId} AND m.user_b = ${viewerId})))
            -- Double dates (phase 22): my friend in my pair, and the four of an open double.
            OR EXISTS (SELECT 1 FROM pairs pa WHERE pa.ended_at IS NULL
                       AND ((pa.user_a = ${viewerId} AND pa.user_b = ${targetId}) OR (pa.user_a = ${targetId} AND pa.user_b = ${viewerId})))
            OR EXISTS (SELECT 1 FROM double_matches dm WHERE dm.closed_at IS NULL
                       AND dm.members @> ARRAY[${viewerId}, ${targetId}]::text[])
          )
      ) AS ok`);
    if (relation.rows[0]?.ok) return true;
    return (
      (await this.candidates(viewerId, { targetId })).length > 0 ||
      (await this.candidates(viewerId, { targetId, mode: 'friend' })).length > 0
    );
  }

  /**
   * May the viewer like the target in this mode: they're a candidate in that mode, or they
   * already liked the viewer in that mode (Likes You), or they're matched.
   */
  private async canLikeIn(viewerId: string, targetId: string, mode: MatchMode): Promise<boolean> {
    if ((await this.candidates(viewerId, { targetId, mode })).length > 0) return true;
    const { rows } = await this.db.execute(sql`
      SELECT 1 FROM interactions i JOIN "user" u ON u.id = i.actor_id AND u.status = 'active'
      WHERE i.actor_id = ${targetId} AND i.target_id = ${viewerId} AND i.kind = 'like'
        AND i.mode = ${mode} AND ${notSeparated(sql`${viewerId}`, sql`${targetId}`)}`);
    return rows.length > 0;
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
    // A paused member (consent for sensitive data withdrawn, or taking a break) is not matched.
    if (!(await this.isActive(actorId))) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Your profile is paused.');
    }
    const mode: MatchMode = input.mode ?? 'date';
    if (!(await this.canView(actorId, input.targetId))) throw notFound();
    // A like belongs to one mode (phase 22): friends mode never reaches the dating deck.
    if (input.kind === 'like' && !(await this.canLikeIn(actorId, input.targetId, mode))) {
      throw notFound();
    }
    // Focus mode (phase 20): with too many people waiting for your reply, answer them first.
    if (input.kind === 'like' && (await this.waitingForReply(actorId)) >= YOUR_TURN_LIMIT) {
      throw new HttpError(409, ErrorCode.YourTurn, 'Reply to the people waiting for you first.');
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
      // Count and insert under one per-member lock, so parallel requests can't pass the limit.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`interactions:${actorId}`}))`);
      const [{ count }] = (
        await tx.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM interactions
        WHERE actor_id = ${actorId} AND created_at >= date_trunc('day', now())`)
      ).rows as [{ count: number }];
      if (count >= DAILY_INTERACTION_LIMIT) {
        throw new HttpError(429, ErrorCode.RateLimited, 'Daily limit reached. Come back tomorrow.');
      }
      const inserted = await tx
        .insert(interactions)
        .values({
          actorId,
          targetId: input.targetId,
          kind: input.kind,
          itemType: input.itemType ?? null,
          itemId: input.itemId ?? null,
          comment: input.comment ?? null,
          mode,
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
            // Both likes in the same mode: a friend like and a dating like aren't a match.
            eq(interactions.mode, mode),
          ),
        );
      if (!reverse) return { matched: false, matchId: null };

      const [a, b] = [actorId, input.targetId].sort() as [string, string];
      await tx.insert(matches).values({ userA: a, userB: b, mode }).onConflictDoNothing();
      const [match] = await tx
        .select({ id: matches.id })
        .from(matches)
        .where(and(eq(matches.userA, a), eq(matches.userB, b)));
      return { matched: true, matchId: match!.id };
    });
    if (result.matchId) {
      this.notify([input.targetId], { type: 'match.new', matchId: result.matchId });
      this.onMatch?.(input.targetId, result.matchId).catch(() => undefined);
      this.appEvents.emit({ type: 'match.created', matchId: result.matchId });
    }
    return result;
  }

  /**
   * Undo a pass (phase 29b): only the member's latest decision, only if it was a pass, and only
   * within UNDO_PASS_MINUTES. Likes can't be undone (the other person may already have matched).
   * The profile comes back only if it may still be shown (not blocked, still a candidate).
   */
  async undoPass(actorId: string): Promise<UndoPassResult> {
    if (!(await this.isActive(actorId))) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Your profile is paused.');
    }
    const [found] = await this.db
      .select({
        row: interactions,
        fresh: sql<boolean>`${interactions.createdAt} > now() - make_interval(mins => ${UNDO_PASS_MINUTES})`,
      })
      .from(interactions)
      .where(eq(interactions.actorId, actorId))
      .orderBy(desc(interactions.createdAt))
      .limit(1);
    if (!found || found.row.kind !== 'pass' || !found.fresh) throw notFound();
    const last = found.row;
    const deleted = await this.db
      .delete(interactions)
      .where(and(eq(interactions.id, last.id), eq(interactions.actorId, actorId)))
      .returning({ id: interactions.id });
    if (deleted.length === 0) throw notFound(); // undone twice at once
    // Candidacy depends on there being no decision, so it's checked after the delete; a profile
    // that may no longer be shown keeps its pass.
    if (!(await this.canView(actorId, last.targetId))) {
      await this.db.insert(interactions).values(last).onConflictDoNothing();
      throw notFound();
    }
    const profile = await this.profile(actorId, last.targetId);
    return { profile, mode: last.mode === 'friend' ? 'friend' : 'date' };
  }

  /**
   * Conversations where the other person wrote last and is waiting for this member (phase 20).
   * Closed chats and chats with someone blocked don't count.
   */
  async waitingForReply(userId: string): Promise<number> {
    const { rows } = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM matches m
      JOIN LATERAL (
        SELECT sender_id FROM messages WHERE match_id = m.id ORDER BY created_at DESC LIMIT 1
      ) last ON true
      WHERE m.unmatched_at IS NULL AND (m.user_a = ${userId} OR m.user_b = ${userId})
        AND last.sender_id <> ${userId}
        AND ${notSeparated(sql`m.user_a`, sql`m.user_b`)}`);
    return rows[0]?.n ?? 0;
  }

  /** Active and not taking a break: may like, pass and see who liked them. */
  private async isActive(userId: string): Promise<boolean> {
    const { rows } = await this.db.execute(
      sql`SELECT 1 FROM "user" u WHERE u.id = ${userId} AND u.status = 'active' AND ${notOnBreak('u')}`,
    );
    return rows.length > 0;
  }

  /** Everyone who liked me and is still waiting for my answer. Free for every user. */
  async likesReceived(viewerId: string): Promise<LikeReceived[]> {
    if (!(await this.isActive(viewerId))) return [];
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
      JOIN "user" u ON u.id = i.actor_id AND u.status = 'active' AND ${notOnBreak('u')}
      LEFT JOIN prompts p ON i.item_type = 'prompt' AND p.id = i.item_id AND p.user_id = ${viewerId}
      WHERE i.target_id = ${viewerId} AND i.kind = 'like' AND i.mode = 'date'
        AND NOT EXISTS (SELECT 1 FROM interactions mine WHERE mine.actor_id = ${viewerId} AND mine.target_id = i.actor_id)
        AND ${notSeparated(sql`${viewerId}`, sql`i.actor_id`)}
        AND ${notContactHidden(sql`${viewerId}`, sql`i.actor_id`)}
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
        mode: matches.mode,
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
      return profile
        ? [{ id: r.id, createdAt: r.createdAt.toISOString(), mode: r.mode as MatchMode, profile }]
        : [];
    });
  }

  /** Unmatch. With `closeMessage` ("close kindly") the other person sees it on a card for a few days. */
  async unmatch(viewerId: string, matchId: string, closeMessage?: string): Promise<void> {
    if (closeMessage !== undefined && checkHarm(closeMessage).flagged) {
      throw new HttpError(
        422,
        ErrorCode.ValidationError,
        'This message may hurt. Please choose kinder words.',
      );
    }
    const updated = await this.db
      .update(matches)
      .set({ unmatchedAt: new Date(), unmatchedBy: viewerId, closeMessage: closeMessage ?? null })
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

  /** Conversations someone closed kindly with me, for a few days (name and message only). */
  async closedConversations(viewerId: string): Promise<ClosedConversation[]> {
    const days = sql.raw(String(CLOSED_CARD_DAYS));
    const { rows } = await this.db.execute<{
      id: string;
      name: string;
      message: string;
      closed_at: string;
    }>(sql`
      SELECT m.id, p.display_name AS name, m.close_message AS message, m.unmatched_at AS closed_at
      FROM matches m
      JOIN profiles p ON p.user_id = m.unmatched_by
      JOIN "user" u ON u.id = m.unmatched_by AND u.status = 'active'
      WHERE (m.user_a = ${viewerId} OR m.user_b = ${viewerId})
        AND m.unmatched_by <> ${viewerId}
        AND m.close_message IS NOT NULL AND m.close_dismissed_at IS NULL
        AND m.unmatched_at > now() - interval '${days} days'
        AND NOT EXISTS (SELECT 1 FROM blocks b
          WHERE (b.blocker_id = m.user_a AND b.blocked_id = m.user_b)
             OR (b.blocker_id = m.user_b AND b.blocked_id = m.user_a))
      ORDER BY m.unmatched_at DESC
      LIMIT 20`);
    return rows.map((r) => ({
      matchId: r.id,
      name: r.name,
      message: r.message,
      closedAt: new Date(r.closed_at).toISOString(),
    }));
  }

  async dismissClosed(viewerId: string, matchId: string): Promise<void> {
    const done = await this.db
      .update(matches)
      .set({ closeDismissedAt: new Date() })
      .where(
        and(
          eq(matches.id, matchId),
          or(eq(matches.userA, viewerId), eq(matches.userB, viewerId)),
          sql`${matches.unmatchedBy} <> ${viewerId}`,
        ),
      )
      .returning({ id: matches.id });
    if (done.length === 0) throw notFound();
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
    this.separated(blockerId, blockedId);
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
      ) OR EXISTS (
        -- A double chat they were in together (phase 22), even after it closed.
        SELECT 1 FROM double_matches dm WHERE dm.members @> ARRAY[${viewerId}, ${targetId}]::text[]
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
    this.separated(userId, null);
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
    const voiceClips = await this.db
      .select({ id: schema.audioClips.id, durationMs: schema.audioClips.durationMs })
      .from(schema.audioClips)
      .innerJoin(profileAbout, eq(profileAbout.voiceAudioId, schema.audioClips.id))
      .where(and(inArray(profileAbout.userId, ids), eq(schema.audioClips.status, 'clean')));
    const cleanVoice = new Map(voiceClips.map((c) => [c.id, c.durationMs]));
    // "Met in person" (phase 20): opt-in, and only after both people of a date confirmed meeting.
    const met = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT u.id AS user_id
      FROM unnest(${sql.param(ids)}::text[]) AS u(id)
      JOIN preferences pr ON pr.user_id = u.id AND pr.show_met_badge
      WHERE EXISTS (
        SELECT 1 FROM date_plans d JOIN matches m ON m.id = d.match_id
        WHERE d.status = 'accepted' AND d.proposer_met AND d.receiver_met
          AND (m.user_a = u.id OR m.user_b = u.id))`);
    const metIds = new Set(met.rows.map((r) => r.user_id));
    // "Checked in at an event" (phase 23): opt-in, a check-in at a venue in the last year.
    const atEvent = await this.db.execute<{ user_id: string }>(sql`
      SELECT p.user_id FROM profiles p
      JOIN preferences pr ON pr.user_id = p.user_id AND pr.show_event_badge
      WHERE p.user_id = ANY(${sql.param(ids)}::text[])
        AND p.event_check_in_at > now() - make_interval(months => ${EVENT_BADGE_MONTHS})`);
    const atEventIds = new Set(atEvent.rows.map((r) => r.user_id));
    // Friends' takes (phase 22): approved by the owner, newest first, at most MAX_SHOWN_TAKES.
    const takesById = new Map<string, PublicTake[]>();
    for (const take of await this.db
      .select({
        ownerId: schema.friendTakes.ownerId,
        name: schema.friendTakes.name,
        relation: schema.friendTakes.relation,
        text: schema.friendTakes.text,
      })
      .from(schema.friendTakes)
      .where(
        and(inArray(schema.friendTakes.ownerId, ids), eq(schema.friendTakes.status, 'approved')),
      )
      .orderBy(desc(schema.friendTakes.decidedAt))) {
      const list = takesById.get(take.ownerId) ?? [];
      if (list.length < MAX_SHOWN_TAKES) {
        list.push({ name: take.name, relation: take.relation as TakeRelation, text: take.text });
      }
      takesById.set(take.ownerId, list);
    }
    const aboutById = new Map(
      (await this.db.select().from(profileAbout).where(inArray(profileAbout.userId, ids))).map(
        (a) => [a.userId, a],
      ),
    );
    // Travellers (phase 18c) show "Visiting {city}" instead of a distance from the city centre.
    const trips = await this.db
      .select({ userId: locations.userId, cityId: locations.travelCityId })
      .from(locations)
      .where(and(inArray(locations.userId, ids), gt(locations.travelUntil, sql`now()`)));
    const visiting = new Map(
      trips.flatMap((trip) => {
        const city = trip.cityId ? this.cities?.get(trip.cityId) : undefined;
        return city
          ? [[trip.userId, { id: city.id, names: city.names, country: city.country }]]
          : [];
      }),
    );

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
          distance:
            Number.isFinite(item.km) && !visiting.has(p.userId) ? distanceBucket(item.km) : null,
          visiting: visiting.get(p.userId) ?? null,
          about: toAbout(aboutById.get(p.userId)),
          voicePrompt: toVoicePrompt(aboutById.get(p.userId), cleanVoice),
          accessNeeds: shownAccessNeeds(aboutById.get(p.userId)),
          metInPerson: metIds.has(p.userId),
          atEvent: atEventIds.has(p.userId),
          friendTakes: takesById.get(p.userId) ?? [],
          verified: p.verifiedAt !== null,
          reasons: item.result?.reasons ?? [],
        },
      ];
    });
  }
}

/** A member's about-me fields as others see them (phase 19), or null if never filled in. */
function toAbout(row: typeof profileAbout.$inferSelect | undefined): About | null {
  if (!row) return null;
  return {
    interests: row.interests as About['interests'],
    children: row.children as About['children'],
    smoking: row.smoking as About['smoking'],
    drinking: row.drinking as About['drinking'],
    heightCm: row.heightCm,
    religion: row.religion as About['religion'],
    openingQuestion: row.openingQuestion,
  };
}

/** Accessibility needs others may see (phase 25): only when the member chose to show them. */
function shownAccessNeeds(row: typeof profileAbout.$inferSelect | undefined): AccessNeed[] {
  return row?.showAccessNeeds ? (row.accessNeeds as AccessNeed[]) : [];
}

/** A voice prompt others can play: only once its clip passed the scan and re-encoding. */
function toVoicePrompt(
  row: typeof profileAbout.$inferSelect | undefined,
  clean: Map<string, number | null>,
): PublicProfile['voicePrompt'] {
  if (!row?.voiceAudioId || !row.voicePromptKey || !clean.has(row.voiceAudioId)) return null;
  return {
    promptKey: row.voicePromptKey as PromptKey,
    audioId: row.voiceAudioId,
    durationMs: clean.get(row.voiceAudioId) ?? null,
  };
}
