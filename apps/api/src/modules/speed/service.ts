// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { randomBytes } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  ageOn,
  CALL_TOKEN_SECONDS,
  ErrorCode,
  SPEED_ANSWER_HOURS,
  SPEED_BREAK_SECONDS,
  SPEED_LATE_JOIN_SECONDS,
  SPEED_LOBBY_TIMEOUT_SECONDS,
  SPEED_ROUND_DEFAULT,
  type SpeedDate,
  type SpeedJoin,
  type SpeedState,
} from '@nexaheart/shared';
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { CallMedia } from '../../lib/livekit.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { DiscoveryService } from '../discovery/service.js';

const { events, eventRsvps, speedLobby, speedDates, profiles } = schema;
const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const conflict = (message: string) => new HttpError(409, ErrorCode.Conflict, message);

type EventRow = typeof events.$inferSelect;
type DateRow = typeof speedDates.$inferSelect;

/** The lobby opens a little before the start, so people can settle in. */
const LOBBY_EARLY_MS = 15 * 60_000;

/**
 * Pairs people for one round: each person gets at most one partner, among the people they may
 * meet. Those with the fewest options (and who waited longest) choose first, so as few people as
 * possible sit out. `random` breaks ties, so rounds don't repeat the same order.
 */
export function pairRound(
  people: { id: string; sat: number }[],
  canMeet: (a: string, b: string) => boolean,
  random: () => number = Math.random,
): [string, string][] {
  const options = new Map(
    people.map((p) => [p.id, people.filter((q) => q.id !== p.id && canMeet(p.id, q.id)).length]),
  );
  const order = people
    .map((p) => ({ ...p, tie: random() }))
    .sort((a, b) => b.sat - a.sat || options.get(a.id)! - options.get(b.id)! || a.tie - b.tie);
  const taken = new Set<string>();
  const pairs: [string, string][] = [];
  for (const person of order) {
    if (taken.has(person.id)) continue;
    const partner = order
      .filter((q) => q.id !== person.id && !taken.has(q.id) && canMeet(person.id, q.id))
      .sort((a, b) => options.get(a.id)! - options.get(b.id)! || a.tie - b.tie)[0];
    if (!partner) continue;
    taken.add(person.id);
    taken.add(partner.id);
    pairs.push([person.id, partner.id]);
  }
  return pairs;
}

/**
 * Video speed dating (phase 23): an event type. In the event window, people who said they're going
 * wait in a lobby; rounds pair those who may see each other under every dating rule, both ways,
 * and who haven't met yet. After each round, each person privately says whether they'd like to
 * match; only a mutual yes opens a match. Rounds are made when someone in the lobby checks in (a
 * heartbeat or a refresh), under an advisory lock per event, so there's no extra scheduler.
 */
export class SpeedService {
  constructor(
    private readonly db: Database,
    private readonly discovery: DiscoveryService,
    private readonly media: CallMedia | null,
    /** Whether video calls are on in this community. */
    private readonly videoOn: () => Promise<boolean>,
    private readonly today: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  // -------------------------------------------------------------- access

  private async speedEvent(eventId: string, userId: string): Promise<EventRow> {
    const [row] = await this.db
      .select({ event: events, status: eventRsvps.status })
      .from(events)
      .leftJoin(eventRsvps, and(eq(eventRsvps.eventId, events.id), eq(eventRsvps.userId, userId)))
      .where(eq(events.id, eventId));
    if (!row || row.event.kind !== 'speed' || row.status !== 'going') throw notFound();
    return row.event;
  }

  private live(event: EventRow): boolean {
    const now = this.now();
    return (
      event.status === 'scheduled' &&
      now >= event.startsAt.getTime() &&
      now < event.endsAt.getTime()
    );
  }

  private roundMs(event: EventRow): number {
    return (event.roundMinutes ?? SPEED_ROUND_DEFAULT) * 60_000;
  }

  // -------------------------------------------------------------- the lobby

  /** Enter the lobby, or stay in it (a heartbeat). */
  async enter(eventId: string, userId: string): Promise<SpeedState> {
    const event = await this.speedEvent(eventId, userId);
    const now = this.now();
    if (
      event.status !== 'scheduled' ||
      now < event.startsAt.getTime() - LOBBY_EARLY_MS ||
      now >= event.endsAt.getTime()
    ) {
      throw conflict('The lobby is open only around the event.');
    }
    if (!this.media || !(await this.videoOn())) {
      throw new HttpError(503, ErrorCode.ServiceUnavailable, 'Video isn’t available right now.');
    }
    const at = new Date(now);
    await this.db
      .insert(speedLobby)
      .values({ eventId, userId, joinedAt: at, lastSeenAt: at })
      .onConflictDoUpdate({
        target: [speedLobby.eventId, speedLobby.userId],
        set: { lastSeenAt: at },
      });
    await this.tick(event);
    return this.stateFor(event, userId);
  }

  async leaveLobby(eventId: string, userId: string): Promise<SpeedState> {
    const event = await this.speedEvent(eventId, userId);
    await this.db
      .delete(speedLobby)
      .where(and(eq(speedLobby.eventId, eventId), eq(speedLobby.userId, userId)));
    return this.stateFor(event, userId);
  }

  async state(eventId: string, userId: string): Promise<SpeedState> {
    const event = await this.speedEvent(eventId, userId);
    await this.tick(event);
    return this.stateFor(event, userId);
  }

  private presentSince(): Date {
    return new Date(this.now() - SPEED_LOBBY_TIMEOUT_SECONDS * 1000);
  }

  // -------------------------------------------------------------- rounds

  /** When the next round may start, or null when no round fits before the end. */
  private async nextRoundAt(event: EventRow): Promise<number | null> {
    const [last] = await this.db
      .select({ endsAt: sql<Date>`max(${speedDates.endsAt})` })
      .from(speedDates)
      .where(eq(speedDates.eventId, event.id));
    const lastEnd = last?.endsAt ? new Date(last.endsAt).getTime() : null;
    const at = Math.max(
      event.startsAt.getTime(),
      lastEnd === null ? 0 : lastEnd + SPEED_BREAK_SECONDS * 1000,
    );
    return at + this.roundMs(event) <= event.endsAt.getTime() ? at : null;
  }

  /** The round on now, if any: its number and when it ends. */
  private async currentRound(eventId: string): Promise<{ round: number; endsAt: Date } | null> {
    const [row] = await this.db
      .select({ round: speedDates.round, endsAt: speedDates.endsAt })
      .from(speedDates)
      .where(and(eq(speedDates.eventId, eventId), gt(speedDates.endsAt, new Date(this.now()))))
      .orderBy(desc(speedDates.round), desc(speedDates.endsAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * What to do now: start the next round when it's due, or, during a round with at least
   * SPEED_LATE_JOIN_SECONDS left, pair people who are waiting (they arrived late, or their partner
   * left) into that round. Null when there's nothing to do.
   */
  private async plan(event: EventRow): Promise<{ round: number | null; endsAt: Date } | null> {
    const current = await this.currentRound(event.id);
    if (current) {
      return current.endsAt.getTime() - this.now() >= SPEED_LATE_JOIN_SECONDS * 1000
        ? current
        : null;
    }
    const due = await this.nextRoundAt(event);
    if (due === null || due > this.now()) return null;
    return { round: null, endsAt: new Date(this.now() + this.roundMs(event)) };
  }

  /**
   * Makes rounds. One request per event does it (an advisory lock); the others see the round a
   * moment later.
   */
  private async tick(event: EventRow): Promise<void> {
    if (!this.live(event) || !this.media) return;
    if (!(await this.plan(event))) return;
    const created = await this.db.transaction(async (tx) => {
      const [{ locked }] = (
        await tx.execute<{ locked: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(hashtext(${`speed:${event.id}`})) AS locked`,
        )
      ).rows as [{ locked: boolean }];
      if (!locked) return [];
      // Checked again under the lock: someone may have made the round just now.
      const plan = await this.plan(event);
      if (!plan) return [];
      const present = await tx
        .select({ userId: speedLobby.userId })
        .from(speedLobby)
        .innerJoin(
          eventRsvps,
          and(
            eq(eventRsvps.eventId, speedLobby.eventId),
            eq(eventRsvps.userId, speedLobby.userId),
            eq(eventRsvps.status, 'going'),
          ),
        )
        .where(
          and(eq(speedLobby.eventId, event.id), gt(speedLobby.lastSeenAt, this.presentSince())),
        );
      const history = await tx
        .select({
          a: speedDates.userA,
          b: speedDates.userB,
          round: speedDates.round,
          live: sql<boolean>`${speedDates.endedEarlyBy} IS NULL AND ${speedDates.endsAt} > ${new Date(this.now())}`,
        })
        .from(speedDates)
        .where(eq(speedDates.eventId, event.id));
      // Anyone on a date right now is busy.
      const busy = new Set(history.filter((h) => h.live).flatMap((h) => [h.a, h.b]));
      const ids = present.map((p) => p.userId).filter((id) => !busy.has(id));
      if (ids.length < 2) return [];
      const met = new Set(history.map((h) => `${h.a}|${h.b}`));
      const round = plan.round ?? history.reduce((max, h) => Math.max(max, h.round), 0) + 1;
      const rounds = new Map<string, number>();
      for (const h of history) {
        rounds.set(h.a, (rounds.get(h.a) ?? 0) + 1);
        rounds.set(h.b, (rounds.get(h.b) ?? 0) + 1);
      }
      // Who each person may meet: the visibility query, both ways (it holds both ways already).
      const partners = new Map<string, Set<string>>();
      for (const id of ids) partners.set(id, await this.discovery.speedPartners(id, ids));
      const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
      const canMeet = (a: string, b: string) =>
        !met.has(key(a, b)) && !!partners.get(a)?.has(b) && !!partners.get(b)?.has(a);
      const pairs = pairRound(
        ids.map((id) => ({ id, sat: round - 1 - (rounds.get(id) ?? 0) })),
        canMeet,
      );
      if (pairs.length === 0) return [];
      const startsAt = new Date(this.now());
      const rows = pairs.map(([x, y]) => {
        const [userA, userB] = [x, y].sort() as [string, string];
        return {
          eventId: event.id,
          round,
          userA,
          userB,
          room: randomBytes(16).toString('hex'),
          startsAt,
          endsAt: plan.endsAt,
        };
      });
      await tx.insert(speedDates).values(rows).onConflictDoNothing();
      return rows.map((r) => r.room);
    });
    for (const room of created) await this.media.createRoom(room).catch(() => undefined);
  }

  // -------------------------------------------------------------- one date

  private async loadDate(id: string, userId: string): Promise<DateRow> {
    const [row] = await this.db
      .select()
      .from(speedDates)
      .where(
        and(eq(speedDates.id, id), or(eq(speedDates.userA, userId), eq(speedDates.userB, userId))),
      );
    if (!row) throw notFound();
    return row;
  }

  private isLive(d: DateRow): boolean {
    const now = this.now();
    return d.endedEarlyBy === null && now >= d.startsAt.getTime() && now < d.endsAt.getTime();
  }

  async join(id: string, userId: string, publicKey: string): Promise<SpeedJoin> {
    const d = await this.loadDate(id, userId);
    if (!this.isLive(d)) throw conflict('This round is over.');
    if (!this.media || !(await this.videoOn())) {
      throw new HttpError(503, ErrorCode.ServiceUnavailable, 'Video isn’t available right now.');
    }
    const token = await this.media.joinToken({
      room: d.room,
      // LiveKit only ever knows the role, never who the person is.
      role: d.userA === userId ? 'caller' : 'callee',
      video: true,
      ttlSeconds: CALL_TOKEN_SECONDS,
      publicKey,
    });
    return { url: this.media.url, token, room: d.room, date: await this.view(d, userId) };
  }

  /** Leaving early ends the round for both. */
  async leave(id: string, userId: string): Promise<SpeedDate> {
    const d = await this.loadDate(id, userId);
    if (this.isLive(d)) {
      await this.db
        .update(speedDates)
        .set({ endedEarlyBy: userId })
        .where(and(eq(speedDates.id, id), isNull(speedDates.endedEarlyBy)));
      await this.media?.deleteRoom(d.room).catch(() => undefined);
    }
    return this.view(await this.loadDate(id, userId), userId);
  }

  /** "Would you like to match?" Private; only a mutual yes opens a match. */
  async answer(id: string, userId: string, yes: boolean): Promise<SpeedDate> {
    const d = await this.loadDate(id, userId);
    const [event] = await this.db.select().from(events).where(eq(events.id, d.eventId));
    if (this.now() < d.startsAt.getTime()) throw conflict('This round hasn’t started yet.');
    if (!event || this.now() > event.endsAt.getTime() + SPEED_ANSWER_HOURS * 3_600_000) {
      throw conflict('Answers for this event are closed.');
    }
    const mine = d.userA === userId ? { answerA: yes } : { answerB: yes };
    const [updated] = await this.db
      .update(speedDates)
      .set(mine)
      .where(eq(speedDates.id, id))
      .returning();
    const row = updated!;
    if (row.answerA && row.answerB && !row.matchId) {
      // Both said yes: the same rules as a like still hold (a block since then stops it).
      const other = row.userA === userId ? row.userB : row.userA;
      if (await this.discovery.canView(userId, other)) {
        const matchId = await this.discovery.matchFromSpeedDate(row.userA, row.userB);
        await this.db.update(speedDates).set({ matchId }).where(eq(speedDates.id, id));
      }
    }
    return this.view(await this.loadDate(id, userId), userId);
  }

  /** A block between two people ends any live round of theirs (phase 22's separation hook). */
  async closeForBlock(a: string, b: string): Promise<void> {
    const [userA, userB] = [a, b].sort() as [string, string];
    const ended = await this.db
      .update(speedDates)
      .set({ endedEarlyBy: a })
      .where(
        and(
          eq(speedDates.userA, userA),
          eq(speedDates.userB, userB),
          isNull(speedDates.endedEarlyBy),
          gt(speedDates.endsAt, new Date(this.now())),
        ),
      )
      .returning({ room: speedDates.room });
    for (const { room } of ended) await this.media?.deleteRoom(room).catch(() => undefined);
  }

  /** An account that lost access (suspended, deleted) leaves every lobby and live round. */
  async closeForUser(userId: string): Promise<void> {
    await this.db.delete(speedLobby).where(eq(speedLobby.userId, userId));
    const ended = await this.db
      .update(speedDates)
      .set({ endedEarlyBy: userId })
      .where(
        and(
          or(eq(speedDates.userA, userId), eq(speedDates.userB, userId)),
          isNull(speedDates.endedEarlyBy),
          gt(speedDates.endsAt, new Date(this.now())),
        ),
      )
      .returning({ room: speedDates.room });
    for (const { room } of ended) await this.media?.deleteRoom(room).catch(() => undefined);
  }

  // -------------------------------------------------------------- views

  private async view(d: DateRow, userId: string, names?: Map<string, NameRow>): Promise<SpeedDate> {
    const otherId = d.userA === userId ? d.userB : d.userA;
    const other = names?.get(otherId) ?? (await this.names([otherId])).get(otherId);
    return {
      id: d.id,
      round: d.round,
      with: {
        id: otherId,
        displayName: other?.displayName ?? '',
        age: other ? ageOn(other.birthDate, this.today()) : 0,
      },
      startsAt: d.startsAt.toISOString(),
      endsAt: d.endsAt.toISOString(),
      status: this.isLive(d) ? 'live' : 'over',
      answer: d.userA === userId ? d.answerA : d.answerB,
      matchId: d.matchId,
    };
  }

  private async names(ids: string[]): Promise<Map<string, NameRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        userId: profiles.userId,
        displayName: profiles.displayName,
        birthDate: profiles.birthDate,
      })
      .from(profiles)
      .where(inArray(profiles.userId, ids));
    return new Map(rows.map((r) => [r.userId, r]));
  }

  private async stateFor(event: EventRow, userId: string): Promise<SpeedState> {
    const [here] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(speedLobby)
      .where(and(eq(speedLobby.eventId, event.id), gt(speedLobby.lastSeenAt, this.presentSince())));
    const [mine] = await this.db
      .select({ lastSeenAt: speedLobby.lastSeenAt })
      .from(speedLobby)
      .where(and(eq(speedLobby.eventId, event.id), eq(speedLobby.userId, userId)));
    const dates = await this.db
      .select()
      .from(speedDates)
      .where(
        and(
          eq(speedDates.eventId, event.id),
          or(eq(speedDates.userA, userId), eq(speedDates.userB, userId)),
          lt(speedDates.startsAt, new Date(this.now() + 1)),
        ),
      )
      .orderBy(desc(speedDates.round));
    const names = await this.names(dates.map((d) => (d.userA === userId ? d.userB : d.userA)));
    const views = await Promise.all(dates.map((d) => this.view(d, userId, names)));
    const live = this.live(event);
    const next = live ? await this.nextRoundAt(event) : null;
    return {
      inLobby: !!mine && mine.lastSeenAt.getTime() > this.presentSince().getTime(),
      here: here?.count ?? 0,
      nextRoundAt: next === null ? null : new Date(Math.max(next, this.now())).toISOString(),
      live,
      current: views.find((v) => v.status === 'live') ?? null,
      past: views.filter((v) => v.status === 'over'),
    };
  }
}

interface NameRow {
  userId: string;
  displayName: string;
  birthDate: string;
}
