import { schema, type Database } from '@nexaheart/db';
import {
  type AdminEvent,
  type CommunityEvent,
  ErrorCode,
  type EventInput,
  type EventUpdate,
  MAX_EVENT_HOURS,
} from '@nexaheart/shared';
import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';

const { events, eventRsvps, venues } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const invalid = (message: string) => new HttpError(422, ErrorCode.ValidationError, message);

type EventRow = typeof events.$inferSelect;
type VenueRow = typeof venues.$inferSelect;

/** What members and staff both see of an event. */
function baseView(e: EventRow, v: VenueRow | null, going: number): Omit<CommunityEvent, 'mine'> {
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
  };
}

const toView = (e: EventRow, v: VenueRow | null, going: number, mine: boolean): CommunityEvent => ({
  ...baseView(e, v, going),
  mine,
});

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
  ) {}

  private query(viewerId: string | null) {
    const going = sql<number>`(SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = ${events.id})`;
    const mine = viewerId
      ? sql<boolean>`EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = ${events.id} AND r.user_id = ${viewerId})`
      : sql<boolean>`false`;
    return this.db
      .select({ event: events, venue: venues, going, mine })
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
    return rows.map((r) => toView(r.event, r.venue, r.going, r.mine));
  }

  async get(id: string, viewerId: string): Promise<CommunityEvent> {
    const [row] = await this.query(viewerId).where(eq(events.id, id));
    if (!row || (row.event.status === 'cancelled' && !row.mine)) throw notFound();
    return toView(row.event, row.venue, row.going, row.mine);
  }

  /**
   * "I'm going". The event row is locked while counting, so two people can't take the last place
   * at the same time. Saying it twice is harmless.
   */
  async rsvp(id: string, userId: string): Promise<CommunityEvent> {
    await this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, id)).for('update');
      if (!event || event.status === 'cancelled') throw notFound();
      if (event.endsAt.getTime() <= this.now()) {
        throw new HttpError(409, ErrorCode.Conflict, 'This event has ended.');
      }
      const [{ going, mine }] = (
        await tx.execute<{ going: number; mine: boolean }>(sql`
          SELECT count(*)::int AS going, bool_or(user_id = ${userId}) AS mine
          FROM event_rsvps WHERE event_id = ${id}`)
      ).rows as [{ going: number; mine: boolean | null }];
      if (mine) return;
      if (event.capacity !== null && going >= event.capacity) {
        throw new HttpError(409, ErrorCode.Conflict, 'This event is full.');
      }
      await tx.insert(eventRsvps).values({ eventId: id, userId }).onConflictDoNothing();
    });
    return this.get(id, userId);
  }

  async cancelRsvp(id: string, userId: string): Promise<CommunityEvent> {
    const [event] = await this.db.select({ id: events.id }).from(events).where(eq(events.id, id));
    if (!event) throw notFound();
    await this.db
      .delete(eventRsvps)
      .where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, userId)));
    return this.get(id, userId);
  }

  // ------------------------------------------------------------------ staff

  async listForStaff(): Promise<AdminEvent[]> {
    const rows = await this.query(null)
      .where(gt(events.endsAt, new Date(this.now() - 30 * 86_400_000)))
      .orderBy(desc(events.startsAt))
      .limit(200);
    return rows.map((r) => this.toAdmin(r.event, r.venue, r.going));
  }

  private toAdmin(e: EventRow, v: VenueRow | null, going: number): AdminEvent {
    return { ...baseView(e, v, going), venueId: e.venueId, createdAt: e.createdAt.toISOString() };
  }

  private async staffView(id: string): Promise<AdminEvent> {
    const [row] = await this.query(null).where(eq(events.id, id));
    if (!row) throw notFound();
    return this.toAdmin(row.event, row.venue, row.going);
  }

  private async requireActiveVenue(venueId: string) {
    const [venue] = await this.db
      .select({ active: venues.active })
      .from(venues)
      .where(eq(venues.id, venueId));
    if (!venue?.active) throw invalid('Choose one of the community’s active places.');
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
    const [row] = await this.db
      .insert(events)
      .values({
        title: input.title,
        description: input.description ?? '',
        venueId: input.venueId,
        startsAt,
        endsAt,
        capacity: input.capacity ?? null,
      })
      .returning({ id: events.id });
    await audit(this.db, {
      actorId,
      action: 'event.create',
      targetType: 'event',
      targetId: row!.id,
    });
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
    await this.db
      .update(events)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.venueId !== undefined ? { venueId: patch.venueId } : {}),
        ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
        startsAt,
        endsAt,
      })
      .where(eq(events.id, id));
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
}
