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
} from '@nexaheart/shared';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { AppEvents } from '../../lib/app-events.js';
import { noEvents } from '../../lib/app-events.js';

const { events, eventRsvps, venues, profiles } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const invalid = (message: string) => new HttpError(422, ErrorCode.ValidationError, message);

type EventRow = typeof events.$inferSelect;
type VenueRow = typeof venues.$inferSelect;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** What members and staff both see of an event. */
function baseView(
  e: EventRow,
  v: VenueRow | null,
  going: number,
  waitingCount: number,
): Omit<CommunityEvent, 'mine' | 'waitingAhead' | 'checkedIn'> {
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
  };
}

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
}

const toView = (r: Row): CommunityEvent => ({
  ...baseView(r.event, r.venue, r.going, r.waitingCount),
  mine: r.mine,
  waitingAhead: r.waitingAhead,
  checkedIn: r.checkedIn,
});

export interface EventOptions {
  /** The web app's address, for the link in the check-in QR code. */
  appUrl?: string;
  /** Whether video speed dating can run (video calls configured and on). */
  speedAvailable?: () => Promise<boolean>;
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
              AND (o.created_at, o.user_id) < (me.created_at, me.user_id))
          FROM event_rsvps me
          WHERE me.event_id = ${events.id} AND me.user_id = ${viewerId} AND me.status = 'waiting')`
      : sql<number | null>`NULL::int`;
    const checkedIn = viewerId
      ? sql<boolean>`EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.user_id = ${viewerId} AND r.checked_in_at IS NOT NULL)`
      : sql<boolean>`false`;
    const checkedInCount = sql<number>`(SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.checked_in_at IS NOT NULL)`;
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
      })
      .from(events)
      .leftJoin(venues, eq(venues.id, events.venueId));
  }

  /** Upcoming scheduled events, plus cancelled ones the viewer was going to (so they see it). */
  async listUpcoming(viewerId: string): Promise<CommunityEvent[]> {
    const rows = await this.query(viewerId)
      .where(
        and(
          gt(events.endsAt, new Date(this.now())),
          or(
            eq(events.status, 'scheduled'),
            sql`EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.user_id = ${viewerId})`,
          ),
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(50);
    return rows.map(toView);
  }

  async get(id: string, viewerId: string): Promise<CommunityEvent> {
    const [row] = await this.query(viewerId).where(eq(events.id, id));
    if (!row || (row.event.status === 'cancelled' && !row.mine && row.waitingAhead === null)) {
      throw notFound();
    }
    return toView(row);
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
      const [{ going, waiting, mine }] = (
        await tx.execute<{ going: number; waiting: number; mine: string | null }>(sql`
          SELECT count(*) FILTER (WHERE status = 'going')::int AS going,
                 count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
                 max(status::text) FILTER (WHERE user_id = ${userId}) AS mine
          FROM event_rsvps WHERE event_id = ${id}`)
      ).rows as [{ going: number; waiting: number; mine: string | null }];
      if (mine === 'going' || (mine === 'waiting' && wait)) return;
      const full = event.capacity !== null && going >= event.capacity;
      if (!full) {
        await tx
          .insert(eventRsvps)
          .values({ eventId: id, userId, status: 'going' })
          .onConflictDoUpdate({
            target: [eventRsvps.eventId, eventRsvps.userId],
            set: { status: 'going' },
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
        .values({ eventId: id, userId, status: 'waiting', createdAt: new Date(this.now()) })
        .onConflictDoNothing();
    });
  }

  /** "I can't go after all" or "leave the waiting list". A freed place goes to the next person. */
  async cancelRsvp(id: string, userId: string): Promise<CommunityEvent> {
    const promoted = await this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, id)).for('update');
      if (!event) throw notFound();
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
    const [{ going }] = (
      await tx.execute<{ going: number }>(sql`
        SELECT count(*)::int AS going FROM event_rsvps
        WHERE event_id = ${event.id} AND status = 'going'`)
    ).rows as [{ going: number }];
    const free = event.capacity === null ? MAX_EVENT_WAITLIST : event.capacity - going;
    if (free <= 0) return [];
    const next = await tx
      .select({ userId: eventRsvps.userId })
      .from(eventRsvps)
      .where(and(eq(eventRsvps.eventId, event.id), eq(eventRsvps.status, 'waiting')))
      .orderBy(asc(eventRsvps.createdAt), asc(eventRsvps.userId))
      .limit(free);
    if (next.length === 0) return [];
    const ids = next.map((n) => n.userId);
    await tx
      .update(eventRsvps)
      .set({ status: 'going' })
      .where(and(eq(eventRsvps.eventId, event.id), inArray(eventRsvps.userId, ids)));
    return ids;
  }

  /** A content-free push: "Update about a community event you are going to". */
  private async tellPromoted(eventId: string, userIds: string[]): Promise<void> {
    for (const userId of userIds) await this.notify(userId, eventId).catch(() => undefined);
  }

  // ------------------------------------------------------------------ staff

  async listForStaff(): Promise<AdminEvent[]> {
    const rows = await this.query(null)
      .where(gt(events.endsAt, new Date(this.now() - 30 * 86_400_000)))
      .orderBy(desc(events.startsAt))
      .limit(200);
    return rows.map((r) => this.toAdmin(r));
  }

  private toAdmin(r: Row): AdminEvent {
    return {
      ...baseView(r.event, r.venue, r.going, r.waitingCount),
      venueId: r.event.venueId,
      createdAt: r.event.createdAt.toISOString(),
      checkedInCount: r.checkedInCount,
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

  async create(actorId: string, input: EventInput): Promise<AdminEvent> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    this.checkWindow(startsAt, endsAt);
    await this.requireActiveVenue(input.venueId);
    const speed = input.kind === 'speed';
    if (speed) await this.requireSpeed();
    const [row] = await this.db
      .insert(events)
      .values({
        title: input.title,
        description: input.description ?? '',
        venueId: input.venueId,
        startsAt,
        endsAt,
        capacity: input.capacity ?? null,
        kind: speed ? 'speed' : 'standard',
        roundMinutes: speed ? (input.roundMinutes ?? SPEED_ROUND_DEFAULT) : null,
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
    if (current.kind === 'speed') {
      if (patch.capacity === null || (patch.capacity ?? 0) > MAX_SPEED_CAPACITY) {
        throw invalid(`Speed dating needs a capacity of at most ${MAX_SPEED_CAPACITY}.`);
      }
    } else if (patch.roundMinutes !== undefined) {
      throw invalid('Only speed-dating events have rounds.');
    }
    // More places (or no limit any more) go to the waiting list straight away.
    const promoted = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(events)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.venueId !== undefined ? { venueId: patch.venueId } : {}),
          ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
          ...(patch.roundMinutes !== undefined ? { roundMinutes: patch.roundMinutes } : {}),
          startsAt,
          endsAt,
        })
        .where(eq(events.id, id))
        .returning();
      return patch.capacity !== undefined && updated ? this.promote(tx, updated) : [];
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
