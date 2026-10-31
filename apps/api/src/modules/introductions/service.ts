// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  firstToHear,
  FRIEND_SUGGESTIONS_DAILY,
  type FriendSuggestPage,
  type IntroductionKind,
  INTRODUCTIONS_DAILY,
  type ConsoleQuery,
  type IntroductionAnswer,
  type IntroductionInput,
  type IntroductionOrder,
  type IntroductionOutcome,
  type IntroductionState,
  type MatchmakerConsole,
  type MatchmakerRow,
  type MyIntroductions,
  type ReceivedIntroduction,
  type SentIntroduction,
} from '@nexaheart/shared';
import { eq, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import { notOnBreak, notSeparated } from '../discovery/visibility.js';
import { photoUrl } from '../me/service.js';

const { matchmakers, user } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const forbidden = () =>
  new HttpError(403, ErrorCode.Forbidden, 'Only community matchmakers can do this.');
/** One answer for every pair that can't be introduced, so it reveals nothing about either. */
const cantIntroduce = () =>
  new HttpError(409, ErrorCode.Conflict, "These two can't be introduced right now.");

/** What the introductions need from discovery (both sides' rules, and opening the match). */
export interface IntroductionDeps {
  isCandidate(viewerId: string, targetId: string): Promise<boolean>;
  match(a: string, b: string): Promise<string>;
  order(): Promise<IntroductionOrder>;
  /** A push "you have an introduction" (no names). */
  notify(userId: string, introductionId: string): void;
}

/** The state as anyone can see it: a no stays "open" until it expires, like no answer. */
const STATE_SQL = sql.raw(`CASE WHEN it.matched_at IS NOT NULL THEN 'matched'
  WHEN it.closed_at IS NOT NULL OR it.expires_at <= now() THEN 'closed' ELSE 'open' END`);

/** The first clean profile photo of `alias`.id, or null. */
const firstPhoto = (column: string) =>
  sql.raw(`(SELECT ph.id FROM photos ph WHERE ph.user_id = ${column} AND ph.purpose = 'profile'
    AND ph.status = 'clean' ORDER BY ph.position LIMIT 1)`);

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/**
 * Phase 68a: community matchmakers, named by the admins, introduce two members who opted in.
 * Each side answers privately; two yeses open a chat. See docs/phases/PHASE-68.md.
 */
export class IntroductionService {
  constructor(
    private readonly db: Database,
    private readonly deps: IntroductionDeps,
  ) {}

  async matchmakerSince(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ at: matchmakers.grantedAt })
      .from(matchmakers)
      .where(eq(matchmakers.userId, userId));
    return row ? row.at.toISOString() : null;
  }

  private async requireMatchmaker(userId: string): Promise<void> {
    if (!(await this.matchmakerSince(userId))) throw forbidden();
  }

  // ---------------------------------------------------------------- the console

  async console(matchmakerId: string, query: ConsoleQuery): Promise<MatchmakerConsole> {
    await this.requireMatchmaker(matchmakerId);
    const q = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const { rows } = await this.db.execute<{
      id: string;
      display_name: string;
      age: number;
      gender: string;
      intention: string;
      photo: string | null;
    }>(sql`
      SELECT u.id, p.display_name, date_part('year', age(current_date, p.birth_date))::int AS age,
        p.gender, p.intention, ${firstPhoto('u.id')} AS photo
      FROM "user" u
      JOIN profiles p ON p.user_id = u.id
      JOIN preferences pf ON pf.user_id = u.id AND pf.open_to_matchmakers
      WHERE u.status = 'active' AND u.id <> ${matchmakerId} AND ${notOnBreak('u')}
        AND p.review_status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = u.id AND bl.blocked_id = ${matchmakerId})
                                                   OR (bl.blocker_id = ${matchmakerId} AND bl.blocked_id = u.id))
        ${q ? sql`AND p.display_name ILIKE ${q}` : sql``}
        ${query.gender ? sql`AND p.gender = ${query.gender}` : sql``}
        ${query.minAge ? sql`AND date_part('year', age(current_date, p.birth_date)) >= ${query.minAge}` : sql``}
        ${query.maxAge ? sql`AND date_part('year', age(current_date, p.birth_date)) <= ${query.maxAge}` : sql``}
      ORDER BY p.display_name, u.id
      LIMIT 50`);
    // Audited like staff access (phase 64), without the search text.
    await audit(this.db, {
      actorId: matchmakerId,
      action: 'matchmaker.search',
      targetType: 'user',
      targetId: matchmakerId,
      meta: { results: rows.length },
    });
    return {
      members: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        age: Number(r.age),
        gender: r.gender as MatchmakerConsole['members'][number]['gender'],
        intention: r.intention as MatchmakerConsole['members'][number]['intention'],
        photoUrl: r.photo ? photoUrl(r.photo) : null,
      })),
      sent: await this.sent(matchmakerId, 'matchmaker'),
      left: Math.max(0, INTRODUCTIONS_DAILY - (await this.sentToday(matchmakerId, 'matchmaker'))),
    };
  }

  private async sentToday(byId: string, kind: IntroductionKind): Promise<number> {
    const { rows } = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM introductions
      WHERE matchmaker_id = ${byId} AND kind = ${kind} AND created_at > now() - interval '24 hours'`);
    return rows[0]?.n ?? 0;
  }

  /** My introductions as a matchmaker: their state, never who answered what. */
  private async sent(byId: string, kind: IntroductionKind): Promise<SentIntroduction[]> {
    const { rows } = await this.db.execute<{
      id: string;
      a_id: string;
      a_name: string;
      b_id: string;
      b_name: string;
      note: string;
      state: IntroductionState;
      outcome: IntroductionOutcome | null;
      created_at: Date;
    }>(sql`
      SELECT it.id, it.a_id, pa.display_name AS a_name, it.b_id, pb.display_name AS b_name, it.note,
        ${STATE_SQL} AS state, it.outcome, it.created_at
      FROM introductions it
      JOIN profiles pa ON pa.user_id = it.a_id JOIN profiles pb ON pb.user_id = it.b_id
      WHERE it.matchmaker_id = ${byId} AND it.kind = ${kind}
      ORDER BY it.created_at DESC LIMIT 50`);
    return rows.map((r) => ({
      id: r.id,
      a: { id: r.a_id, displayName: r.a_name },
      b: { id: r.b_id, displayName: r.b_name },
      note: r.note,
      state: r.state,
      outcome: r.outcome,
      createdAt: iso(r.created_at)!,
    }));
  }

  async introduce(matchmakerId: string, input: IntroductionInput): Promise<{ id: string }> {
    await this.requireMatchmaker(matchmakerId);
    return this.create(matchmakerId, input, 'matchmaker');
  }

  // ---------------------------------------------------------------- friends who suggest (68c)

  /** People I'm friends with here: a friends-mode match, or my double-date pair. */
  private async friendsOf(userId: string) {
    const { rows } = await this.db.execute<{
      id: string;
      display_name: string;
      photo: string | null;
    }>(sql`
      SELECT o.id, p.display_name, ${firstPhoto('o.id')} AS photo
      FROM "user" o JOIN profiles p ON p.user_id = o.id
      WHERE o.status = 'active' AND o.id IN (
        SELECT CASE WHEN m.user_a = ${userId} THEN m.user_b ELSE m.user_a END FROM matches m
        WHERE m.unmatched_at IS NULL AND m.mode = 'friend'
          AND (m.user_a = ${userId} OR m.user_b = ${userId})
        UNION
        SELECT CASE WHEN pa.user_a = ${userId} THEN pa.user_b ELSE pa.user_a END FROM pairs pa
        WHERE pa.ended_at IS NULL AND (pa.user_a = ${userId} OR pa.user_b = ${userId}))
      ORDER BY p.display_name, o.id`);
    return rows;
  }

  async friendPage(userId: string): Promise<FriendSuggestPage> {
    return {
      friends: (await this.friendsOf(userId)).map((r) => ({
        id: r.id,
        displayName: r.display_name,
        photoUrl: r.photo ? photoUrl(r.photo) : null,
      })),
      sent: await this.sent(userId, 'friend'),
      left: Math.max(0, FRIEND_SUGGESTIONS_DAILY - (await this.sentToday(userId, 'friend'))),
    };
  }

  /** A friend suggests two of their friends to each other: the same private answers. */
  async suggest(userId: string, input: IntroductionInput): Promise<{ id: string }> {
    const friends = new Set((await this.friendsOf(userId)).map((f) => f.id));
    if (!friends.has(input.aId) || !friends.has(input.bId)) throw cantIntroduce();
    return this.create(userId, input, 'friend');
  }

  private async create(
    byId: string,
    input: IntroductionInput,
    kind: IntroductionKind,
  ): Promise<{ id: string }> {
    const { aId, bId, note } = input;
    if (aId === byId || bId === byId) throw cantIntroduce();
    const daily = kind === 'friend' ? FRIEND_SUGGESTIONS_DAILY : INTRODUCTIONS_DAILY;
    if ((await this.sentToday(byId, kind)) >= daily) {
      throw new HttpError(429, ErrorCode.RateLimited, `At most ${daily} a day.`);
    }
    // Matchmakers: members who opted in. Friends: members who didn't turn friend suggestions off.
    const consent =
      kind === 'friend' ? sql.raw('pf.friend_suggestions') : sql.raw('pf.open_to_matchmakers');
    const { rows: people } = await this.db.execute<{ id: string; gender: string }>(sql`
      SELECT u.id, p.gender FROM "user" u
      JOIN profiles p ON p.user_id = u.id AND p.review_status = 'approved'
      JOIN preferences pf ON pf.user_id = u.id AND ${consent}
      WHERE u.id IN (${aId}, ${bId}) AND u.status = 'active' AND ${notOnBreak('u')}`);
    const a = people.find((p) => p.id === aId);
    const b = people.find((p) => p.id === bId);
    if (!a || !b) throw cantIntroduce();
    // Every dating rule both ways (preferences, blocks, contact hides), no pass either way, no
    // match ever, no open introduction of the two, and never again after either said no.
    const { rows: blocked } = await this.db.execute(sql`
      SELECT 1 WHERE NOT (${notSeparated(sql`${aId}`, sql`${bId}`)})
        OR EXISTS (SELECT 1 FROM interactions i WHERE i.kind = 'pass'
                   AND ((i.actor_id = ${aId} AND i.target_id = ${bId}) OR (i.actor_id = ${bId} AND i.target_id = ${aId})))
        OR EXISTS (SELECT 1 FROM matches m
                   WHERE (m.user_a = ${aId} AND m.user_b = ${bId}) OR (m.user_a = ${bId} AND m.user_b = ${aId}))
        OR EXISTS (SELECT 1 FROM introductions it
                   WHERE ((it.a_id = ${aId} AND it.b_id = ${bId}) OR (it.a_id = ${bId} AND it.b_id = ${aId}))
                     AND ((it.matched_at IS NULL AND it.closed_at IS NULL AND it.expires_at > now())
                          OR it.a_answer = 'no' OR it.b_answer = 'no'))`);
    if (blocked.length > 0) throw cantIntroduce();
    if (!(await this.deps.isCandidate(aId, bId)) || !(await this.deps.isCandidate(bId, aId))) {
      throw cantIntroduce();
    }
    const firstId = firstToHear(await this.deps.order(), a, b);
    const id = await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO introductions (matchmaker_id, kind, a_id, b_id, note, first_id, expires_at)
        VALUES (${byId}, ${kind}, ${aId}, ${bId}, ${note}, ${firstId},
          now() + make_interval(hours => COALESCE((SELECT introduction_hours FROM instance_settings WHERE id = 1), 336)))
        RETURNING id`);
      const created = rows[0]!.id;
      await audit(tx, {
        actorId: byId,
        action: 'introduction.created',
        targetType: 'introduction',
        targetId: created,
        meta: { kind, order: firstId ? 'women_first' : 'together' },
      });
      return created;
    });
    for (const to of firstId ? [firstId] : [aId, bId]) this.deps.notify(to, id);
    return { id };
  }

  // ---------------------------------------------------------------- the members introduced

  /** Introductions that reached me (women first: the other side only after her yes). */
  async mine(userId: string): Promise<MyIntroductions> {
    const { rows } = await this.db.execute<{
      id: string;
      kind: IntroductionKind;
      mm_name: string | null;
      mm_since: Date | null;
      note: string;
      other_id: string;
      other_name: string;
      other_photo: string | null;
      my_answer: IntroductionAnswer | null;
      state: IntroductionState;
      match_id: string | null;
      outcome: IntroductionOutcome | null;
      created_at: Date;
      expires_at: Date;
    }>(sql`
      SELECT it.id, it.kind, pm.display_name AS mm_name, mk.granted_at AS mm_since, it.note,
        o.id AS other_id, po.display_name AS other_name, ${firstPhoto('o.id')} AS other_photo,
        CASE WHEN it.a_id = ${userId} THEN it.a_answer ELSE it.b_answer END AS my_answer,
        ${STATE_SQL} AS state, it.match_id, it.outcome, it.created_at, it.expires_at
      FROM introductions it
      JOIN "user" o ON o.id = CASE WHEN it.a_id = ${userId} THEN it.b_id ELSE it.a_id END
      JOIN profiles po ON po.user_id = o.id
      LEFT JOIN profiles pm ON pm.user_id = it.matchmaker_id
      LEFT JOIN matchmakers mk ON mk.user_id = it.matchmaker_id
      WHERE (it.a_id = ${userId} OR it.b_id = ${userId})
        AND (it.first_id IS NULL OR it.first_id = ${userId}
             OR (it.first_id = it.a_id AND it.a_answer = 'yes')
             OR (it.first_id = it.b_id AND it.b_answer = 'yes'))
        AND ${notSeparated(sql`${userId}`, sql`o.id`)}
      ORDER BY it.created_at DESC LIMIT 50`);
    const received: ReceivedIntroduction[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      // A friend's suggestion names the friend, never with a matchmaker's badge.
      matchmaker: r.mm_name
        ? { displayName: r.mm_name, since: r.kind === 'matchmaker' ? iso(r.mm_since) : null }
        : null,
      note: r.note,
      other: {
        id: r.other_id,
        displayName: r.other_name,
        photoUrl: r.other_photo ? photoUrl(r.other_photo) : null,
      },
      myAnswer: r.my_answer,
      // My own no closes it for me (the other side still sees it as open until it expires).
      state: r.my_answer === 'no' && r.state === 'open' ? 'closed' : r.state,
      matchId: r.state === 'matched' ? r.match_id : null,
      outcome: r.outcome,
      createdAt: iso(r.created_at)!,
      expiresAt: iso(r.expires_at)!,
    }));
    return { received, matchmakerSince: await this.matchmakerSince(userId) };
  }

  async answer(
    userId: string,
    id: string,
    answer: IntroductionAnswer,
  ): Promise<{ state: IntroductionState; matchId: string | null }> {
    const result = await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{
        a_id: string;
        b_id: string;
        first_id: string | null;
        a_answer: string | null;
        b_answer: string | null;
      }>(sql`
        SELECT it.a_id, it.b_id, it.first_id, it.a_answer, it.b_answer FROM introductions it
        WHERE it.id = ${id} AND (it.a_id = ${userId} OR it.b_id = ${userId})
          AND it.matched_at IS NULL AND it.closed_at IS NULL AND it.expires_at > now()
        FOR UPDATE`);
      const row = rows[0];
      if (!row) throw notFound();
      const iAmA = row.a_id === userId;
      const otherId = iAmA ? row.b_id : row.a_id;
      const mine = iAmA ? row.a_answer : row.b_answer;
      const theirs = iAmA ? row.b_answer : row.a_answer;
      const reached = !row.first_id || row.first_id === userId || theirs === 'yes';
      if (!reached || mine !== null) throw notFound();
      const side = iAmA ? sql.raw('a') : sql.raw('b');
      await tx.execute(sql`
        UPDATE introductions SET ${side}_answer = ${answer}, ${side}_answered_at = now()
        WHERE id = ${id}`);
      // The second side gets its own time (the community's window) once the first said yes.
      const extend = answer === 'yes' && row.first_id === userId;
      if (extend) {
        await tx.execute(sql`
          UPDATE introductions
          SET expires_at = GREATEST(expires_at, now() + make_interval(hours => COALESCE((SELECT introduction_hours FROM instance_settings WHERE id = 1), 336)))
          WHERE id = ${id}`);
      }
      await audit(tx, {
        actorId: userId,
        action: 'introduction.answered',
        targetType: 'introduction',
        targetId: id,
      });
      return { otherId, both: answer === 'yes' && theirs === 'yes', notifyOther: extend };
    });
    if (result.notifyOther) this.deps.notify(result.otherId, id);
    if (answer === 'no') return { state: 'closed', matchId: null };
    if (!result.both) return { state: 'open', matchId: null };
    // A block since the introduction: no match (and nothing said about why).
    const { rows } = await this.db.execute(
      sql`SELECT 1 WHERE ${notSeparated(sql`${userId}`, sql`${result.otherId}`)}`,
    );
    if (rows.length === 0) return { state: 'open', matchId: null };
    const matchId = await this.deps.match(userId, result.otherId);
    await this.db.execute(sql`
      UPDATE introductions SET match_id = ${matchId}, matched_at = now() WHERE id = ${id}`);
    return { state: 'matched', matchId };
  }

  /** Credit: either of the two tells the matchmaker how it went (after a match). */
  async outcome(userId: string, id: string, outcome: IntroductionOutcome): Promise<void> {
    const { rows } = await this.db.execute(sql`
      UPDATE introductions SET outcome = ${outcome}, outcome_at = now()
      WHERE id = ${id} AND (a_id = ${userId} OR b_id = ${userId}) AND matched_at IS NOT NULL
      RETURNING id`);
    if (rows.length === 0) throw notFound();
    await audit(this.db, {
      actorId: userId,
      action: 'introduction.outcome',
      targetType: 'introduction',
      targetId: id,
      meta: { outcome },
    });
  }

  // ---------------------------------------------------------------- the dashboard (admins)

  async grant(adminId: string, email: string): Promise<{ userId: string }> {
    const [member] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = lower(${email}) AND ${user.status} = 'active'`);
    if (!member) throw new HttpError(404, ErrorCode.NotFound, 'No active member with this email.');
    await this.db.transaction(async (tx) => {
      await tx
        .insert(matchmakers)
        .values({ userId: member.id, grantedBy: adminId })
        .onConflictDoNothing();
      await audit(tx, {
        actorId: adminId,
        action: 'matchmaker.granted',
        targetType: 'user',
        targetId: member.id,
      });
    });
    return { userId: member.id };
  }

  /** Taking the role back closes the matchmaker's open introductions at once. */
  async revoke(adminId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(matchmakers)
        .where(eq(matchmakers.userId, userId))
        .returning({ userId: matchmakers.userId });
      if (removed.length === 0) throw notFound();
      const { rows } = await tx.execute(sql`
        UPDATE introductions SET closed_at = now()
        WHERE matchmaker_id = ${userId} AND kind = 'matchmaker' AND matched_at IS NULL
          AND closed_at IS NULL
          AND expires_at > now()
        RETURNING id`);
      await audit(tx, {
        actorId: adminId,
        action: 'matchmaker.revoked',
        targetType: 'user',
        targetId: userId,
        meta: { closed: rows.length },
      });
    });
  }

  /** Per matchmaker: introductions sent in the period, and how many matched, met, married. */
  async report(range: {
    from?: string | undefined;
    to?: string | undefined;
  }): Promise<MatchmakerRow[]> {
    const from = range.from ?? '1970-01-01';
    const to = range.to ?? '9999-12-31';
    const { rows } = await this.db.execute<{
      user_id: string;
      display_name: string;
      since: Date;
      introductions: number;
      matches: number;
      met: number;
      engaged: number;
      married: number;
    }>(sql`
      SELECT mk.user_id, p.display_name, mk.granted_at AS since,
        count(it.id)::int AS introductions,
        count(it.matched_at)::int AS matches,
        count(*) FILTER (WHERE it.outcome IN ('met', 'engaged', 'married'))::int AS met,
        count(*) FILTER (WHERE it.outcome IN ('engaged', 'married'))::int AS engaged,
        count(*) FILTER (WHERE it.outcome = 'married')::int AS married
      FROM matchmakers mk
      JOIN profiles p ON p.user_id = mk.user_id
      LEFT JOIN introductions it ON it.matchmaker_id = mk.user_id AND it.kind = 'matchmaker'
        AND it.created_at >= ${from}::date AND it.created_at < ${to}::date + 1
      GROUP BY mk.user_id, p.display_name, mk.granted_at
      ORDER BY p.display_name`);
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      since: iso(r.since)!,
      introductions: r.introductions,
      matches: r.matches,
      met: r.met,
      engaged: r.engaged,
      married: r.married,
    }));
  }
}
