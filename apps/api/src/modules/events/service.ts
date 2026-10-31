// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  type AdminCheckIn,
  type AdminEvent,
  CHECK_IN_EARLY_MINUTES,
  CHECK_IN_STEP_SECONDS,
  type CommunityEvent,
  ErrorCode,
  type EventInput,
  type EventUpdate,
  MAX_EVENT_HOURS,
  MAX_EVENT_WAITLIST,
  MAX_SPEED_CAPACITY,
  SPEED_ROUND_DEFAULT,
  MAX_OPEN_EVENT_QUESTIONS,
  MAX_URGENT_EVENT_QUESTIONS,
  type EventBoard,
  type EventQuestion,
  type EventAudience,
  eventAudienceSchema,
  MEET_AGAIN_HOURS,
  type MyNoShows,
  NO_SHOW_LATE_PLACE_HOURS,
  NO_SHOW_LIMIT,
  NO_SHOW_PAUSE_DAYS,
  NO_SHOW_WINDOW_DAYS,
  ageOn,
  type NotForYouReason,
} from '@nexaheart/shared';
import { checkHarm } from '@nexaheart/ai';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { readCommunitySettings } from '../../lib/community-settings.js';
import { setTablesIfDue } from './tables.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { AppEvents } from '../../lib/app-events.js';
import { noEvents } from '../../lib/app-events.js';

const { events, eventRsvps, eventQuestions, eventUpdates, venues, profiles } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const invalid = (message: string) => new HttpError(422, ErrorCode.ValidationError, message);

type EventRow = typeof events.$inferSelect;
type VenueRow = typeof venues.$inferSelect;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

type PoolCounts = Record<string, { going: number; waiting: number }>;

/** Phase 71b: what decides whether a member may take a place (profile facts only). */
interface ViewerFacts {
  gender: string;
  birthDate: string;
  /** Only stored with the religion consent (phase 62b). */
  stream: string | null;
}

/** Phase 71b: why a member can't take a place at this event, or null. */
export function notForYou(e: EventRow, f: ViewerFacts, today: string): NotForYouReason | null {
  const genders = e.pools ? e.pools.map((p) => p.gender) : e.audienceGenders;
  if (genders.length > 0 && !genders.includes(f.gender)) return 'gender';
  const age = ageOn(f.birthDate, today);
  if ((e.ageMin !== null && age < e.ageMin) || (e.ageMax !== null && age > e.ageMax)) return 'age';
  if (e.faithStreams.length > 0 && (!f.stream || !e.faithStreams.includes(f.stream))) {
    return 'faith';
  }
  return null;
}

/** The group a member's place is in: their gender when the event has places by gender. */
const poolOf = (e: EventRow, f: ViewerFacts | null): string | null =>
  e.pools ? (f?.gender ?? null) : null;

/** What members and staff both see of an event. */
function baseView(
  e: EventRow,
  v: VenueRow | null,
  going: number,
  waitingCount: number,
  poolCounts: PoolCounts = {},
  organizer: CommunityEvent['organizer'] = null,
): Omit<
  CommunityEvent,
  'mine' | 'waitingAhead' | 'checkedIn' | 'meetAgainUntil' | 'notForYou' | 'placeHidden'
> {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    venue: v
      ? {
          name: v.name,
          area: v.area,
          category: v.category,
          address: v.address,
          note: v.note,
          stepFree: v.stepFree,
        }
      : null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    status: e.status,
    capacity: e.capacity,
    going,
    full: e.capacity !== null && going >= e.capacity,
    waitingCount,
    kind: e.kind === 'speed' ? 'speed' : 'standard',
    roundMinutes: e.kind === 'speed' ? (e.roundMinutes ?? SPEED_ROUND_DEFAULT) : null,
    audience: {
      genders: e.audienceGenders as CommunityEvent['audience']['genders'],
      ageMin: e.ageMin,
      ageMax: e.ageMax,
      faithStreams: e.faithStreams,
    },
    pools: e.pools
      ? e.pools.map((p) => ({
          gender: p.gender as NonNullable<CommunityEvent['pools']>[number]['gender'],
          capacity: p.capacity,
          going: poolCounts[p.gender]?.going ?? 0,
          waiting: poolCounts[p.gender]?.waiting ?? 0,
        }))
      : null,
    placeRevealAt: placeRevealAt(e)?.toISOString() ?? null,
    tableSize: e.tableSize,
    organizer,
  };
}

/** Phase 71e: the organizer on an event (first name, events already held), or null. */
const organizerOf = (r: Row): CommunityEvent['organizer'] =>
  r.event.organizerId && r.organizerName
    ? { displayName: r.organizerName, events: r.organizerEvents }
    : null;

/** Phase 71d: when the place is revealed to members, or null when it's shown from the start. */
export const placeRevealAt = (e: EventRow): Date | null =>
  e.revealHours ? new Date(e.startsAt.getTime() - e.revealHours * 3_600_000) : null;

/** Phase 71d: when the tables are set: the reveal, or the start. */
export const tablesAt = (e: EventRow): Date => placeRevealAt(e) ?? e.startsAt;

/**
 * The 6-digit check-in code for one 30-second window: HMAC-SHA256 of the event's secret and the
 * window number, like a TOTP. A photo of the screen stops working within a minute.
 */
export function checkInCode(secret: string, step: number): string {
  const mac = createHmac('sha256', Buffer.from(secret, 'hex')).update(`check-in:${step}`).digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

interface Row {
  event: EventRow;
  venue: VenueRow | null;
  going: number;
  waitingCount: number;
  mine: boolean;
  waitingAhead: number | null;
  checkedIn: boolean;
  checkedInCount: number;
  poolCounts: PoolCounts;
  tableSizes: number[] | null;
  organizerName: string | null;
  organizerEvents: number;
}

const toQuestion = (q: typeof eventQuestions.$inferSelect): EventQuestion => ({
  id: q.id,
  body: q.body,
  urgent: q.urgent,
  answer: q.answer,
  answeredAt: q.answeredAt?.toISOString() ?? null,
  createdAt: q.createdAt.toISOString(),
});

/**
 * Phase 71a: until when "Meet again" is open for someone who checked in at an in-person event, or
 * null (not checked in, video speed dating, cancelled, not ended yet, or closed).
 */
export function meetAgainUntil(e: EventRow, checkedIn: boolean, now: number): Date | null {
  if (!checkedIn || e.kind === 'speed' || e.status !== 'scheduled') return null;
  const until = e.endsAt.getTime() + MEET_AGAIN_HOURS * 3_600_000;
  return now >= e.endsAt.getTime() && now < until ? new Date(until) : null;
}

const toView = (r: Row, now: number, facts: ViewerFacts | null): CommunityEvent => {
  const base = baseView(r.event, r.venue, r.going, r.waitingCount, r.poolCounts, organizerOf(r));
  // Phase 71b: with places by gender, "full" is about the viewer's own group.
  const pool = poolOf(r.event, facts);
  const mine = pool ? base.pools?.find((p) => p.gender === pool) : undefined;
  // Phase 71d: until the reveal, members see the area only.
  const reveal = placeRevealAt(r.event);
  const hidden = reveal !== null && now < reveal.getTime() && base.venue !== null;
  return {
    ...base,
    venue: hidden && base.venue ? { ...base.venue, name: '', address: '', note: null } : base.venue,
    placeHidden: hidden,
    full: mine ? mine.going >= mine.capacity : base.full,
    mine: r.mine,
    waitingAhead: r.waitingAhead,
    checkedIn: r.checkedIn,
    meetAgainUntil: meetAgainUntil(r.event, r.checkedIn, now)?.toISOString() ?? null,
    notForYou: facts ? notForYou(r.event, facts, new Date(now).toISOString().slice(0, 10)) : null,
  };
};

/**
 * Phase 71a: the member's missed events in the window, newest first: "going", didn't check in,
 * at an ended in-person event where someone did check in (so check-in was used), and not a place
 * given from the waiting list in the last hours before the start.
 */
function missedSql(userId: string, since: Date, now: Date) {
  return sql`
    SELECT e.id AS event_id, e.title, e.ends_at, r.excused_at
    FROM event_rsvps r JOIN events e ON e.id = r.event_id
    WHERE r.user_id = ${userId} AND r.status = 'going' AND r.checked_in_at IS NULL
      AND e.status = 'scheduled' AND e.kind = 'standard'
      AND e.ends_at <= ${now.toISOString()}::timestamptz AND e.ends_at > ${since.toISOString()}::timestamptz
      AND (r.promoted_at IS NULL
           OR r.promoted_at < e.starts_at - make_interval(hours => ${NO_SHOW_LATE_PLACE_HOURS}))
      AND EXISTS (SELECT 1 FROM event_rsvps c WHERE c.event_id = e.id AND c.checked_in_at IS NOT NULL)
    ORDER BY e.ends_at DESC`;
}

export interface EventOptions {
  /** The web app's address, for the link in the check-in QR code. */
  appUrl?: string;
  /** Whether video speed dating can run (video calls configured and on). */
  speedAvailable?: () => Promise<boolean>;
  /** Phase 71c: a content-free push to an admin: someone at an event needs help. */
  helpPush?: (adminId: string, eventId: string) => Promise<void>;
}

/**
 * Community events (phase 14). Members only ever see how many people are going, never who; the
 * RSVP rows are read here for counts and for the viewer's own answer only.
 */
export class EventService {
  constructor(
    private readonly db: Database,
    /** Content-free push to someone going (event cancelled). */
    private readonly notify: (userId: string, eventId: string) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly options: EventOptions = {},
  ) {}

  /** Integrations listen here (phase 24). */
  appEvents: AppEvents = noEvents;

  private query(viewerId: string | null) {
    const count = (status: 'going' | 'waiting') =>
      sql<number>`(SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.status = ${status})`;
    const mine = viewerId
      ? sql<boolean>`EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.user_id = ${viewerId} AND r.status = 'going')`
      : sql<boolean>`false`;
    // The viewer's place in the queue: people who joined earlier (ties by id), or null.
    const waitingAhead = viewerId
      ? sql<number | null>`(SELECT (SELECT count(*)::int FROM event_rsvps o
            WHERE o.event_id = me.event_id AND o.status = 'waiting'
              AND o.pool IS NOT DISTINCT FROM me.pool
              AND (o.created_at, o.user_id) < (me.created_at, me.user_id))
          FROM event_rsvps me
          WHERE me.event_id = ${events.id} AND me.user_id = ${viewerId} AND me.status = 'waiting')`
      : sql<number | null>`NULL::int`;
    const checkedIn = viewerId
      ? sql<boolean>`EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.user_id = ${viewerId} AND r.checked_in_at IS NOT NULL)`
      : sql<boolean>`false`;
    const checkedInCount = sql<number>`(SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.checked_in_at IS NOT NULL)`;
    // Phase 71b: going and waiting in each group (counts only).
    const poolCounts = sql<PoolCounts>`(SELECT coalesce(jsonb_object_agg(x.pool, jsonb_build_object('going', x.going, 'waiting', x.waiting)), '{}'::jsonb)
      FROM (SELECT r.pool, count(*) FILTER (WHERE r.status = 'going')::int AS going,
                   count(*) FILTER (WHERE r.status = 'waiting')::int AS waiting
            FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.pool IS NOT NULL
            GROUP BY r.pool) x)`;
    // Phase 71d: people at each table, in table order (counts only).
    const tableSizes = sql<number[] | null>`(SELECT array_agg(x.n ORDER BY x.table_no)
      FROM (SELECT r.table_no, count(*)::int AS n FROM event_rsvps r
            WHERE r.event_id = ${events.id} AND r.table_no IS NOT NULL AND r.status = 'going'
            GROUP BY r.table_no) x)`;
    // Phase 71e: the organizer's first name, and how many of their events already took place.
    const organizerName = sql<
      string | null
    >`(SELECT p.display_name FROM profiles p WHERE p.user_id = ${events.organizerId})`;
    const organizerEvents = sql<number>`(SELECT count(*)::int FROM events o
      WHERE o.organizer_id = ${events.organizerId} AND o.status = 'scheduled'
        AND o.ends_at < ${new Date(this.now()).toISOString()}::timestamptz)`;
    return this.db
      .select({
        event: events,
        venue: venues,
        going: count('going'),
        waitingCount: count('waiting'),
        mine,
        waitingAhead,
        checkedIn,
        checkedInCount,
        poolCounts,
        tableSizes,
        organizerName,
        organizerEvents,
      })
      .from(events)
      .leftJoin(venues, eq(venues.id, events.venueId));
  }

  /** Upcoming scheduled events, plus cancelled ones the viewer was going to (so they see it). */
  async listUpcoming(viewerId: string): Promise<CommunityEvent[]> {
    const rows = await this.query(viewerId)
      .where(
        and(
          or(
            gt(events.endsAt, new Date(this.now())),
            // Phase 71a: an event I checked in at, while "Meet again" is open.
            and(
              gt(events.endsAt, new Date(this.now() - MEET_AGAIN_HOURS * 3_600_000)),
              eq(events.kind, 'standard'),
              sql`EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.user_id = ${viewerId} AND r.checked_in_at IS NOT NULL)`,
            ),
          ),
          or(
            eq(events.status, 'scheduled'),
            sql`EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.user_id = ${viewerId})`,
          ),
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(50);
    const facts = await this.facts(viewerId);
    return rows.map((r) => toView(r, this.now(), facts));
  }

  /** Phase 71b: the profile facts an audience is checked against (null without a profile). */
  private async facts(userId: string): Promise<ViewerFacts | null> {
    const { rows } = await this.db.execute<{
      gender: string;
      birth_date: string;
      faith_stream: string | null;
    }>(sql`
      SELECT p.gender, p.birth_date::text AS birth_date, a.faith_stream
      FROM profiles p LEFT JOIN profile_about a ON a.user_id = p.user_id
      WHERE p.user_id = ${userId}`);
    const row = rows[0];
    return row ? { gender: row.gender, birthDate: row.birth_date, stream: row.faith_stream } : null;
  }

  async get(id: string, viewerId: string): Promise<CommunityEvent> {
    const [row] = await this.query(viewerId).where(eq(events.id, id));
    if (!row || (row.event.status === 'cancelled' && !row.mine && row.waitingAhead === null)) {
      throw notFound();
    }
    return toView(row, this.now(), await this.facts(viewerId));
  }

  /**
   * "I'm going". The event row is locked while counting, so two people can't take the last place
   * at the same time. Saying it twice is harmless.
   */
  async rsvp(id: string, userId: string): Promise<CommunityEvent> {
    await this.answer(id, userId, false);
    return this.get(id, userId);
  }

  /**
   * The waiting list of a full event (phase 16). If a place is free after all, the member is simply
   * going. Joining twice is harmless; at most MAX_EVENT_WAITLIST people wait.
   */
  async joinWaitlist(id: string, userId: string): Promise<CommunityEvent> {
    await this.answer(id, userId, true);
    return this.get(id, userId);
  }

  private async answer(id: string, userId: string, wait: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, id)).for('update');
      if (!event || event.status === 'cancelled') throw notFound();
      if (event.endsAt.getTime() <= this.now()) {
        throw new HttpError(409, ErrorCode.Conflict, 'This event has ended.');
      }
      const [{ mine }] = (
        await tx.execute<{ mine: string | null }>(sql`
          SELECT max(status::text) AS mine FROM event_rsvps
          WHERE event_id = ${id} AND user_id = ${userId}`)
      ).rows as [{ mine: string | null }];
      if (mine === 'going' || (mine === 'waiting' && wait)) return;
      // Phase 71b: who it's for, and the member's group when places are by gender.
      const facts = await this.facts(userId);
      const reason = facts
        ? notForYou(event, facts, new Date(this.now()).toISOString().slice(0, 10))
        : 'gender';
      if (reason) {
        throw new HttpError(
          403,
          ErrorCode.Forbidden,
          `This event is for another group (${reason}).`,
        );
      }
      const pool = poolOf(event, facts);
      const [{ going, waiting }] = (
        await tx.execute<{ going: number; waiting: number }>(sql`
          SELECT count(*) FILTER (WHERE status = 'going')::int AS going,
                 count(*) FILTER (WHERE status = 'waiting')::int AS waiting
          FROM event_rsvps WHERE event_id = ${id} AND pool IS NOT DISTINCT FROM ${pool}`)
      ).rows as [{ going: number; waiting: number }];
      const capacityHere = event.pools
        ? (event.pools.find((p) => p.gender === pool)?.capacity ?? 0)
        : event.capacity;
      const paused = await this.pausedUntil(userId);
      if (paused) {
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          `New places are paused until ${paused.toISOString()} after missed events.`,
        );
      }
      const full = capacityHere !== null && going >= capacityHere;
      if (!full) {
        await tx
          .insert(eventRsvps)
          .values({ eventId: id, userId, status: 'going', pool })
          .onConflictDoUpdate({
            target: [eventRsvps.eventId, eventRsvps.userId],
            set: { status: 'going', pool },
          });
        return;
      }
      if (!wait) {
        throw new HttpError(409, ErrorCode.Conflict, 'This event is full. Join the waiting list.');
      }
      if (waiting >= MAX_EVENT_WAITLIST) {
        throw new HttpError(409, ErrorCode.Conflict, 'The waiting list is full.');
      }
      await tx
        .insert(eventRsvps)
        .values({ eventId: id, userId, status: 'waiting', pool, createdAt: new Date(this.now()) })
        .onConflictDoNothing();
    });
  }

  /** "I can't go after all" or "leave the waiting list". A freed place goes to the next person. */
  async cancelRsvp(id: string, userId: string): Promise<CommunityEvent> {
    const promoted = await this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, id)).for('update');
      if (!event) throw notFound();
      // Phase 71a: once it ended there's nothing to leave (and a miss or a check-in stays as it is).
      if (event.status === 'scheduled' && event.endsAt.getTime() <= this.now()) {
        throw new HttpError(409, ErrorCode.Conflict, 'This event has ended.');
      }
      const removed = await tx
        .delete(eventRsvps)
        .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, userId)))
        .returning({ status: eventRsvps.status });
      return removed[0]?.status === 'going' ? this.promote(tx, event) : [];
    });
    await this.tellPromoted(id, promoted);
    return this.get(id, userId);
  }

  /**
   * Fills free places from the waiting list, first come first served, while the event hasn't
   * started. Runs inside the transaction that holds the event's row lock.
   */
  private async promote(tx: Tx, event: EventRow): Promise<string[]> {
    if (event.status !== 'scheduled' || event.startsAt.getTime() <= this.now()) return [];
    // Phase 71b: with places by gender, each group fills from its own waiting list.
    const groups = event.pools
      ? event.pools.map((p) => ({ pool: p.gender as string | null, capacity: p.capacity }))
      : [{ pool: null, capacity: event.capacity }];
    const promoted: string[] = [];
    for (const group of groups) {
      const [{ going }] = (
        await tx.execute<{ going: number }>(sql`
          SELECT count(*)::int AS going FROM event_rsvps
          WHERE event_id = ${event.id} AND status = 'going'
            AND pool IS NOT DISTINCT FROM ${group.pool}`)
      ).rows as [{ going: number }];
      const free = group.capacity === null ? MAX_EVENT_WAITLIST : group.capacity - going;
      if (free <= 0) continue;
      const next = await tx
        .select({ userId: eventRsvps.userId })
        .from(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, event.id),
            eq(eventRsvps.status, 'waiting'),
            group.pool === null ? isNull(eventRsvps.pool) : eq(eventRsvps.pool, group.pool),
          ),
        )
        .orderBy(asc(eventRsvps.createdAt), asc(eventRsvps.userId))
        .limit(free);
      if (next.length === 0) continue;
      const ids = next.map((n) => n.userId);
      await tx
        .update(eventRsvps)
        .set({ status: 'going', promotedAt: new Date(this.now()) })
        .where(and(eq(eventRsvps.eventId, event.id), inArray(eventRsvps.userId, ids)));
      promoted.push(...ids);
    }
    return promoted;
  }

  /** A content-free push: "Update about a community event you are going to". */
  private async tellPromoted(eventId: string, userIds: string[]): Promise<void> {
    for (const userId of userIds) await this.notify(userId, eventId).catch(() => undefined);
  }

  // ------------------------------------------------------------------ no-shows (phase 71a)

  private async missed(userId: string) {
    const since = new Date(this.now() - NO_SHOW_WINDOW_DAYS * 86_400_000);
    const { rows } = await this.db.execute<{
      event_id: string;
      title: string;
      ends_at: string | Date;
      excused_at: string | Date | null;
    }>(missedSql(userId, since, new Date(this.now())));
    return rows.map((r) => ({
      eventId: r.event_id,
      title: r.title,
      endedAt: new Date(r.ends_at),
      excused: r.excused_at !== null,
      excusedAt: r.excused_at === null ? null : new Date(r.excused_at),
    }));
  }

  /**
   * NO_SHOW_LIMIT misses (not excused) in the window pause new places and waiting lists for
   * NO_SHOW_PAUSE_DAYS from the latest; null when not paused.
   */
  private async pausedUntil(userId: string): Promise<Date | null> {
    const counted = (await this.missed(userId)).filter((m) => !m.excused);
    if (counted.length < NO_SHOW_LIMIT) return null;
    const until = counted[0]!.endedAt.getTime() + NO_SHOW_PAUSE_DAYS * 86_400_000;
    return until > this.now() ? new Date(until) : null;
  }

  /** The member's own misses, whether places are paused, and whether they can excuse one. */
  async myNoShows(userId: string): Promise<MyNoShows> {
    const missed = await this.missed(userId);
    const paused = await this.pausedUntil(userId);
    const excusedRecently = await this.excusedRecently(userId);
    return {
      noShows: missed.map((m) => ({
        eventId: m.eventId,
        title: m.title,
        endedAt: m.endedAt.toISOString(),
        excused: m.excused,
      })),
      pausedUntil: paused?.toISOString() ?? null,
      canExcuse: !excusedRecently && missed.some((m) => !m.excused),
    };
  }

  /** Excused anything in the last NO_SHOW_WINDOW_DAYS days (kept on the RSVP, so within it). */
  private async excusedRecently(userId: string): Promise<boolean> {
    const since = new Date(this.now() - NO_SHOW_WINDOW_DAYS * 86_400_000);
    const { rows } = await this.db.execute(sql`
      SELECT 1 FROM event_rsvps
      WHERE user_id = ${userId} AND excused_at > ${since.toISOString()}::timestamptz LIMIT 1`);
    return rows.length > 0;
  }

  /**
   * "I was there, or something came up": no questions asked, once in NO_SHOW_WINDOW_DAYS days.
   * Only the member's own miss; staff never see who missed.
   */
  async excuse(userId: string, eventId: string): Promise<MyNoShows> {
    const miss = (await this.missed(userId)).find((m) => m.eventId === eventId);
    if (!miss) throw notFound();
    if (!miss.excused) {
      if (await this.excusedRecently(userId)) {
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          'You can excuse one missed event a month. This one still counts.',
        );
      }
      await this.db
        .update(eventRsvps)
        .set({ excusedAt: new Date(this.now()) })
        .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
    }
    return this.myNoShows(userId);
  }

  // ------------------------------------------------------------------ staff

  /** Phase 71e: an organizer's own events (upcoming and the last 30 days), as members see them. */
  async listForOrganizer(userId: string): Promise<CommunityEvent[]> {
    const rows = await this.query(userId)
      .where(
        and(
          eq(events.organizerId, userId),
          gt(events.endsAt, new Date(this.now() - 30 * 86_400_000)),
        ),
      )
      .orderBy(asc(events.startsAt));
    const facts = await this.facts(userId);
    return rows.map((r) => toView(r, this.now(), facts));
  }

  async listForStaff(): Promise<AdminEvent[]> {
    // Phase 71d: tables that are due are set now, so staff see their counts.
    const due = await this.db
      .select()
      .from(events)
      .where(
        and(
          sql`${events.tableSize} IS NOT NULL`,
          isNull(events.tablesSetAt),
          eq(events.status, 'scheduled'),
          gt(events.endsAt, new Date(this.now())),
        ),
      );
    for (const e of due) await setTablesIfDue(this.db, e, this.now());
    const rows = await this.query(null)
      .where(gt(events.endsAt, new Date(this.now() - 30 * 86_400_000)))
      .orderBy(desc(events.startsAt))
      .limit(200);
    return rows.map((r) => this.toAdmin(r));
  }

  private toAdmin(r: Row): AdminEvent {
    return {
      ...baseView(r.event, r.venue, r.going, r.waitingCount, r.poolCounts, organizerOf(r)),
      venueId: r.event.venueId,
      createdAt: r.event.createdAt.toISOString(),
      checkedInCount: r.checkedInCount,
      tables: r.event.tablesSetAt ? (r.tableSizes ?? []) : null,
    };
  }

  private async staffView(id: string): Promise<AdminEvent> {
    const [row] = await this.query(null).where(eq(events.id, id));
    if (!row) throw notFound();
    return this.toAdmin(row);
  }

  private async requireActiveVenue(venueId: string) {
    const [venue] = await this.db
      .select({ active: venues.active })
      .from(venues)
      .where(eq(venues.id, venueId));
    if (!venue?.active) throw invalid('Choose one of the community’s active places.');
  }

  private async requireSpeed() {
    if (this.options.speedAvailable && !(await this.options.speedAvailable())) {
      throw new HttpError(
        409,
        ErrorCode.Conflict,
        'Video speed dating needs video calls: turn them on first.',
      );
    }
  }

  private checkWindow(startsAt: Date, endsAt: Date) {
    if (startsAt.getTime() <= this.now()) throw invalid('The event must start in the future.');
    const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
    if (hours <= 0 || hours > MAX_EVENT_HOURS) {
      throw invalid(`The end must be after the start, at most ${MAX_EVENT_HOURS} hours later.`);
    }
  }

  /**
   * Phase 71b: who it's for, as columns. Streams only with the faith module on (special-category
   * data, matched against a stream given with the religion consent).
   */
  private async audienceColumns(audience: EventAudience | undefined) {
    if (!audience) return {};
    if (audience.faithStreams.length > 0 && !(await readCommunitySettings(this.db)).faith) {
      throw invalid('Turn on the faith module before making an event for a stream.');
    }
    return {
      audienceGenders: [...new Set(audience.genders)],
      ageMin: audience.ageMin,
      ageMax: audience.ageMax,
      faithStreams: [...new Set(audience.faithStreams)],
    };
  }

  async create(actorId: string, input: EventInput): Promise<AdminEvent> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    this.checkWindow(startsAt, endsAt);
    await this.requireActiveVenue(input.venueId);
    const speed = input.kind === 'speed';
    if (speed) await this.requireSpeed();
    const audience = await this.audienceColumns(
      input.audience ? eventAudienceSchema.parse(input.audience) : undefined,
    );
    const pools = input.pools ?? null;
    const [row] = await this.db
      .insert(events)
      .values({
        title: input.title,
        description: input.description ?? '',
        venueId: input.venueId,
        startsAt,
        endsAt,
        // With places by gender, the capacity is their sum.
        capacity: pools ? pools.reduce((n, p) => n + p.capacity, 0) : (input.capacity ?? null),
        kind: speed ? 'speed' : 'standard',
        roundMinutes: speed ? (input.roundMinutes ?? SPEED_ROUND_DEFAULT) : null,
        ...audience,
        pools,
        revealHours: input.revealHours ?? null,
        tableSize: input.tableSize ?? null,
      })
      .returning({ id: events.id });
    await audit(this.db, {
      actorId,
      action: 'event.create',
      targetType: 'event',
      targetId: row!.id,
    });
    this.appEvents.emit({ type: 'event.created', eventId: row!.id });
    return this.staffView(row!.id);
  }

  async update(actorId: string, id: string, patch: EventUpdate): Promise<AdminEvent> {
    const [current] = await this.db.select().from(events).where(eq(events.id, id));
    if (!current) throw notFound();
    if (current.status === 'cancelled') {
      throw new HttpError(409, ErrorCode.Conflict, 'This event was cancelled.');
    }
    const startsAt = patch.startsAt ? new Date(patch.startsAt) : current.startsAt;
    const endsAt = patch.endsAt ? new Date(patch.endsAt) : current.endsAt;
    if (patch.startsAt || patch.endsAt) this.checkWindow(startsAt, endsAt);
    if (patch.venueId) await this.requireActiveVenue(patch.venueId);
    // Phase 71b: places by gender set the capacity (their sum); null goes back to one list.
    const pools = patch.pools !== undefined ? patch.pools : current.pools;
    const capacity =
      patch.pools !== undefined && pools
        ? pools.reduce((n, p) => n + p.capacity, 0)
        : patch.capacity !== undefined
          ? patch.capacity
          : current.capacity;
    if (current.kind === 'speed') {
      if (capacity === null || capacity > MAX_SPEED_CAPACITY) {
        throw invalid(`Speed dating needs a capacity of at most ${MAX_SPEED_CAPACITY}.`);
      }
    } else if (patch.roundMinutes !== undefined) {
      throw invalid('Only speed-dating events have rounds.');
    }
    const audience = await this.audienceColumns(patch.audience);
    // More places (or no limit any more) go to the waiting list straight away.
    const promoted = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(events)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.venueId !== undefined ? { venueId: patch.venueId } : {}),
          ...(patch.capacity !== undefined || patch.pools !== undefined ? { capacity } : {}),
          ...(patch.roundMinutes !== undefined ? { roundMinutes: patch.roundMinutes } : {}),
          ...(patch.pools !== undefined ? { pools } : {}),
          ...(patch.revealHours !== undefined ? { revealHours: patch.revealHours } : {}),
          ...(patch.tableSize !== undefined ? { tableSize: patch.tableSize } : {}),
          ...audience,
          startsAt,
          endsAt,
        })
        .where(eq(events.id, id))
        .returning();
      if (patch.pools !== undefined) {
        // People already going or waiting keep their place, in their group (gender) or in one list.
        await tx.execute(
          pools
            ? sql`UPDATE event_rsvps r SET pool = p.gender::text FROM profiles p
                  WHERE p.user_id = r.user_id AND r.event_id = ${id} AND r.pool IS NULL`
            : sql`UPDATE event_rsvps SET pool = NULL WHERE event_id = ${id}`,
        );
      }
      return (patch.capacity !== undefined || patch.pools !== undefined) && updated
        ? this.promote(tx, updated)
        : [];
    });
    await this.tellPromoted(id, promoted);
    await audit(this.db, {
      actorId,
      action: 'event.update',
      targetType: 'event',
      targetId: id,
      meta: { fields: Object.keys(patch).sort().join(',') },
    });
    return this.staffView(id);
  }

  /**
   * Phase 71b: "Repeat weekly": copies a week apart with the same place, details, audience and
   * places; each has its own people going.
   */
  async repeat(actorId: string, id: string, weeks: number): Promise<AdminEvent[]> {
    const [current] = await this.db.select().from(events).where(eq(events.id, id));
    if (!current) throw notFound();
    if (current.status === 'cancelled') {
      throw new HttpError(409, ErrorCode.Conflict, 'This event was cancelled.');
    }
    const week = 7 * 86_400_000;
    const copies = Array.from({ length: weeks }, (_, i) => ({
      title: current.title,
      description: current.description,
      venueId: current.venueId,
      startsAt: new Date(current.startsAt.getTime() + (i + 1) * week),
      endsAt: new Date(current.endsAt.getTime() + (i + 1) * week),
      capacity: current.capacity,
      kind: current.kind,
      roundMinutes: current.roundMinutes,
      audienceGenders: current.audienceGenders,
      ageMin: current.ageMin,
      ageMax: current.ageMax,
      faithStreams: current.faithStreams,
      pools: current.pools,
      revealHours: current.revealHours,
      tableSize: current.tableSize,
    }));
    const rows = await this.db.insert(events).values(copies).returning({ id: events.id });
    await audit(this.db, {
      actorId,
      action: 'event.repeat',
      targetType: 'event',
      targetId: id,
      meta: { weeks: String(weeks) },
    });
    for (const row of rows) this.appEvents.emit({ type: 'event.created', eventId: row.id });
    return Promise.all(rows.map((r) => this.staffView(r.id)));
  }

  /** Cancels the event and tells everyone going (a content-free push). */
  async cancel(actorId: string, id: string): Promise<AdminEvent> {
    const [updated] = await this.db
      .update(events)
      .set({ status: 'cancelled' })
      .where(and(eq(events.id, id), eq(events.status, 'scheduled')))
      .returning({ id: events.id });
    if (!updated) {
      const [exists] = await this.db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, id));
      if (!exists) throw notFound();
      throw new HttpError(409, ErrorCode.Conflict, 'This event was already cancelled.');
    }
    const going = await this.db
      .select({ userId: eventRsvps.userId })
      .from(eventRsvps)
      .where(eq(eventRsvps.eventId, id));
    for (const { userId } of going) await this.notify(userId, id).catch(() => undefined);
    await audit(this.db, {
      actorId,
      action: 'event.cancel',
      targetType: 'event',
      targetId: id,
      meta: { notified: going.length },
    });
    return this.staffView(id);
  }

  // ------------------------------------------------- updates and questions (phase 27)

  /** The event, if this member is going or waiting; otherwise it doesn't exist for them. */
  private async requireAttendee(eventId: string, userId: string): Promise<EventRow> {
    const [row] = await this.db
      .select({ event: events })
      .from(events)
      .innerJoin(eventRsvps, and(eq(eventRsvps.eventId, events.id), eq(eventRsvps.userId, userId)))
      .where(eq(events.id, eventId));
    if (!row) throw notFound();
    return row.event;
  }

  /** Updates and the member's own questions, for people going or waiting. */
  async board(eventId: string, userId: string): Promise<EventBoard> {
    await this.requireAttendee(eventId, userId);
    return {
      updates: await this.updatesOf(eventId),
      questions: (
        await this.db
          .select()
          .from(eventQuestions)
          .where(and(eq(eventQuestions.eventId, eventId), eq(eventQuestions.userId, userId)))
          .orderBy(desc(eventQuestions.createdAt))
      ).map(toQuestion),
    };
  }

  async ask(eventId: string, userId: string, body: string, urgent = false): Promise<EventQuestion> {
    const event = await this.requireAttendee(eventId, userId);
    if (event.status !== 'scheduled' || event.endsAt.getTime() <= this.now()) {
      throw new HttpError(409, ErrorCode.Conflict, 'This event is over.');
    }
    if (checkHarm(body).flagged) throw invalid('Please rephrase your question.');
    if (urgent) {
      // Phase 71c: "I need help now", during the event only, a few times at most.
      if (this.now() < event.startsAt.getTime() - CHECK_IN_EARLY_MINUTES * 60_000) {
        throw new HttpError(409, ErrorCode.Conflict, 'Urgent help opens when the event starts.');
      }
      const [{ n }] = (
        await this.db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM event_questions
          WHERE event_id = ${eventId} AND user_id = ${userId} AND urgent`)
      ).rows as [{ n: number }];
      if (n >= MAX_URGENT_EVENT_QUESTIONS) {
        throw new HttpError(429, ErrorCode.RateLimited, 'The organizers have your messages.');
      }
      const [row] = await this.db
        .insert(eventQuestions)
        .values({ eventId, userId, body, urgent: true })
        .returning();
      await this.tellAdminsHelp(eventId);
      return toQuestion(row!);
    }
    const [open] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventQuestions)
      .where(
        and(
          eq(eventQuestions.eventId, eventId),
          eq(eventQuestions.userId, userId),
          isNull(eventQuestions.answeredAt),
        ),
      );
    if ((open?.n ?? 0) >= MAX_OPEN_EVENT_QUESTIONS) {
      throw new HttpError(429, ErrorCode.RateLimited, 'Wait for an answer before asking more.');
    }
    const [row] = await this.db
      .insert(eventQuestions)
      .values({ eventId, userId, body })
      .returning();
    return toQuestion(row!);
  }

  /** Phase 71c: every admin gets a content-free push (best effort). */
  private async tellAdminsHelp(eventId: string): Promise<void> {
    if (!this.options.helpPush) return;
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM "user" WHERE role = 'admin' AND status = 'active'`);
    for (const { id } of rows) await this.options.helpPush(id, eventId).catch(() => undefined);
  }

  async deleteQuestion(eventId: string, userId: string, questionId: string): Promise<void> {
    const deleted = await this.db
      .delete(eventQuestions)
      .where(
        and(
          eq(eventQuestions.id, questionId),
          eq(eventQuestions.eventId, eventId),
          eq(eventQuestions.userId, userId),
        ),
      )
      .returning({ id: eventQuestions.id });
    if (deleted.length === 0) throw notFound();
  }

  /** Staff: updates, and questions without who asked. */
  async staffBoard(eventId: string): Promise<EventBoard> {
    await this.staffView(eventId);
    return {
      updates: await this.updatesOf(eventId),
      questions: (
        await this.db
          .select()
          .from(eventQuestions)
          .where(eq(eventQuestions.eventId, eventId))
          // Phase 71c: someone needing help (and not answered yet) comes first.
          .orderBy(
            sql`(${eventQuestions.urgent} AND ${eventQuestions.answeredAt} IS NULL) DESC`,
            asc(eventQuestions.createdAt),
          )
      ).map(toQuestion),
    };
  }

  /** Posts an update and tells everyone going or waiting (a content-free push). */
  async postUpdate(actorId: string, eventId: string, body: string): Promise<EventBoard> {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) throw notFound();
    if (event.status !== 'scheduled' || event.endsAt.getTime() <= this.now()) {
      throw new HttpError(409, ErrorCode.Conflict, 'Updates can be posted until the event ends.');
    }
    const [row] = await this.db
      .insert(eventUpdates)
      .values({ eventId, authorId: actorId, body })
      .returning({ id: eventUpdates.id });
    const people = await this.db
      .select({ userId: eventRsvps.userId })
      .from(eventRsvps)
      .where(eq(eventRsvps.eventId, eventId));
    for (const { userId } of people) await this.notify(userId, eventId).catch(() => undefined);
    await audit(this.db, {
      actorId,
      action: 'event.update_posted',
      targetType: 'event',
      targetId: eventId,
      meta: { update: row!.id, notified: people.length },
    });
    return this.staffBoard(eventId);
  }

  async deleteUpdate(actorId: string, eventId: string, updateId: string): Promise<EventBoard> {
    const deleted = await this.db
      .delete(eventUpdates)
      .where(and(eq(eventUpdates.id, updateId), eq(eventUpdates.eventId, eventId)))
      .returning({ id: eventUpdates.id });
    if (deleted.length === 0) throw notFound();
    await audit(this.db, {
      actorId,
      action: 'event.update_deleted',
      targetType: 'event',
      targetId: eventId,
      meta: { update: updateId },
    });
    return this.staffBoard(eventId);
  }

  /** Answers a question privately; only the asker sees it (a content-free push tells them). */
  async answerQuestion(
    actorId: string,
    eventId: string,
    questionId: string,
    answer: string,
  ): Promise<EventBoard> {
    const [row] = await this.db
      .update(eventQuestions)
      .set({ answer, answeredBy: actorId, answeredAt: new Date(this.now()) })
      .where(and(eq(eventQuestions.id, questionId), eq(eventQuestions.eventId, eventId)))
      .returning({ userId: eventQuestions.userId });
    if (!row) throw notFound();
    await this.notify(row.userId, eventId).catch(() => undefined);
    await audit(this.db, {
      actorId,
      action: 'event.question_answered',
      targetType: 'event',
      targetId: eventId,
      meta: { question: questionId },
    });
    return this.staffBoard(eventId);
  }

  private async updatesOf(eventId: string) {
    const rows = await this.db
      .select({ id: eventUpdates.id, body: eventUpdates.body, createdAt: eventUpdates.createdAt })
      .from(eventUpdates)
      .where(eq(eventUpdates.eventId, eventId))
      .orderBy(desc(eventUpdates.createdAt));
    return rows.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }));
  }

  // ------------------------------------------------------------------ check-in (phase 23)

  private step(): number {
    return Math.floor(this.now() / 1000 / CHECK_IN_STEP_SECONDS);
  }

  /** The code to show at the venue now, and when it changes. Admins only. */
  async checkInFor(id: string): Promise<AdminCheckIn> {
    const [event] = await this.db.select().from(events).where(eq(events.id, id));
    if (!event) throw notFound();
    if (event.status === 'cancelled') {
      throw new HttpError(409, ErrorCode.Conflict, 'This event was cancelled.');
    }
    let secret = event.checkInSecret;
    if (!secret) {
      // Made once, the first time the code is shown; never sent to members.
      const fresh = randomBytes(32).toString('hex');
      const [row] = await this.db
        .update(events)
        .set({ checkInSecret: sql`coalesce(${events.checkInSecret}, ${fresh})` })
        .where(eq(events.id, id))
        .returning({ secret: events.checkInSecret });
      secret = row!.secret!;
    }
    const step = this.step();
    const code = checkInCode(secret, step);
    const [{ count }] = (
      await this.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM event_rsvps
        WHERE event_id = ${id} AND checked_in_at IS NOT NULL`)
    ).rows as [{ count: number }];
    const base = (this.options.appUrl ?? '').replace(/\/+$/, '');
    return {
      code,
      url: `${base}/events/${id}?code=${code}`,
      changesAt: new Date((step + 1) * CHECK_IN_STEP_SECONDS * 1000).toISOString(),
      checkedInCount: count,
    };
  }

  /**
   * Checking in at the venue with the code on its screen: during the event (from 30 minutes before),
   * with a "going" RSVP. The current and the previous code are accepted. Doing it twice is harmless.
   */
  async checkIn(id: string, userId: string, code: string): Promise<CommunityEvent> {
    const [event] = await this.db.select().from(events).where(eq(events.id, id));
    const [rsvp] = event
      ? await this.db
          .select({ status: eventRsvps.status, checkedInAt: eventRsvps.checkedInAt })
          .from(eventRsvps)
          .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, userId)))
      : [];
    if (!event || event.status === 'cancelled' || rsvp?.status !== 'going') throw notFound();
    if (rsvp.checkedInAt) return this.get(id, userId);
    const now = this.now();
    if (
      now < event.startsAt.getTime() - CHECK_IN_EARLY_MINUTES * 60_000 ||
      now > event.endsAt.getTime()
    ) {
      throw new HttpError(409, ErrorCode.Conflict, 'Check-in is open only during the event.');
    }
    const step = this.step();
    const given = Buffer.from(code);
    const ok =
      !!event.checkInSecret &&
      [step, step - 1].some((s) => {
        const expected = Buffer.from(checkInCode(event.checkInSecret!, s));
        return expected.length === given.length && timingSafeEqual(expected, given);
      });
    if (!ok) throw invalid('That code didn’t work. Check the screen at the venue and try again.');
    const at = new Date(now);
    await this.db.transaction(async (tx) => {
      await tx
        .update(eventRsvps)
        .set({ checkedInAt: at })
        .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, userId)));
      await tx.update(profiles).set({ eventCheckInAt: at }).where(eq(profiles.userId, userId));
    });
    return this.get(id, userId);
  }
}
