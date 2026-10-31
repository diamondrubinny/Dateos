// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  type AdminCheckIn,
  ErrorCode,
  type EventBoard,
  type EventProposal,
  type EventProposalInput,
  MAX_PENDING_PROPOSALS,
  type OrganizerHome,
  type OrganizerRow,
  type ProposalStatus,
} from '@nexaheart/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { EventService } from './service.js';

const { events, eventOrganizers, eventProposals, venues, user, profiles } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const invalid = (message: string) => new HttpError(422, ErrorCode.ValidationError, message);

/** Declined proposals are kept this long, for the organizer to read the reason. */
export const DECLINED_PROPOSAL_DAYS = 90;

type ProposalRow = typeof eventProposals.$inferSelect;
type VenueRow = typeof venues.$inferSelect;

const toProposal = (
  p: ProposalRow,
  v: VenueRow | null,
  organizer?: { userId: string; displayName: string },
): EventProposal => ({
  id: p.id,
  title: p.title,
  description: p.description,
  venueId: p.venueId,
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
  startsAt: p.startsAt.toISOString(),
  endsAt: p.endsAt.toISOString(),
  capacity: p.capacity,
  status: p.status as ProposalStatus,
  reason: p.reason,
  eventId: p.eventId,
  createdAt: p.createdAt.toISOString(),
  ...(organizer ? { organizer } : {}),
});

/**
 * Community organizers (phase 71e): members an admin appointed propose in-person events; an admin
 * approves or declines each. On their own events they post updates, answer questions (without
 * seeing who asked) and show the check-in code. They're members, not staff: no dashboard, no
 * attendee list.
 */
export class OrganizerService {
  constructor(
    private readonly db: Database,
    private readonly events: EventService,
    private readonly now: () => number = Date.now,
  ) {}

  async isOrganizer(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: eventOrganizers.userId })
      .from(eventOrganizers)
      .where(eq(eventOrganizers.userId, userId));
    return Boolean(row);
  }

  private async requireOrganizer(userId: string) {
    if (!(await this.isOrganizer(userId))) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Only community organizers can do this.');
    }
  }

  // ------------------------------------------------------------------ organizers

  async home(userId: string): Promise<OrganizerHome> {
    const organizer = await this.isOrganizer(userId);
    const rows = await this.db
      .select({ p: eventProposals, v: venues })
      .from(eventProposals)
      .leftJoin(venues, eq(venues.id, eventProposals.venueId))
      .where(eq(eventProposals.organizerId, userId))
      .orderBy(desc(eventProposals.createdAt))
      .limit(50);
    return {
      organizer,
      proposals: rows.map((r) => toProposal(r.p, r.v)),
      events: organizer ? await this.events.listForOrganizer(userId) : [],
    };
  }

  async propose(userId: string, input: EventProposalInput): Promise<OrganizerHome> {
    await this.requireOrganizer(userId);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (startsAt.getTime() <= this.now()) throw invalid('The event must start in the future.');
    const [venue] = await this.db
      .select({ active: venues.active })
      .from(venues)
      .where(eq(venues.id, input.venueId));
    if (!venue?.active) throw invalid('Choose one of the community’s active places.');
    const [{ n }] = (
      await this.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM event_proposals
        WHERE organizer_id = ${userId} AND status = 'pending'`)
    ).rows as [{ n: number }];
    if (n >= MAX_PENDING_PROPOSALS) {
      throw new HttpError(
        429,
        ErrorCode.RateLimited,
        'Wait for the admins to answer your proposals before sending more.',
      );
    }
    await this.db.insert(eventProposals).values({
      organizerId: userId,
      title: input.title,
      description: input.description ?? '',
      venueId: input.venueId,
      startsAt,
      endsAt,
      capacity: input.capacity ?? null,
      createdAt: new Date(this.now()),
    });
    return this.home(userId);
  }

  async withdraw(userId: string, id: string): Promise<OrganizerHome> {
    const removed = await this.db
      .delete(eventProposals)
      .where(
        and(
          eq(eventProposals.id, id),
          eq(eventProposals.organizerId, userId),
          eq(eventProposals.status, 'pending'),
        ),
      )
      .returning({ id: eventProposals.id });
    if (removed.length === 0) throw notFound();
    return this.home(userId);
  }

  /** One of my own events, while I'm still an organizer; otherwise it doesn't exist for me. */
  private async ownEvent(userId: string, eventId: string): Promise<void> {
    await this.requireOrganizer(userId);
    const [row] = await this.db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.organizerId, userId)));
    if (!row) throw notFound();
  }

  async board(userId: string, eventId: string): Promise<EventBoard> {
    await this.ownEvent(userId, eventId);
    return this.events.staffBoard(eventId);
  }

  async postUpdate(userId: string, eventId: string, body: string): Promise<EventBoard> {
    await this.ownEvent(userId, eventId);
    return this.events.postUpdate(userId, eventId, body);
  }

  async answer(
    userId: string,
    eventId: string,
    questionId: string,
    answer: string,
  ): Promise<EventBoard> {
    await this.ownEvent(userId, eventId);
    return this.events.answerQuestion(userId, eventId, questionId, answer);
  }

  async checkIn(userId: string, eventId: string): Promise<AdminCheckIn> {
    await this.ownEvent(userId, eventId);
    return this.events.checkInFor(eventId);
  }

  // ------------------------------------------------------------------ admins

  async list(): Promise<OrganizerRow[]> {
    const { rows } = await this.db.execute<{
      user_id: string;
      display_name: string;
      since: Date;
      events: number;
    }>(sql`
      SELECT o.user_id, p.display_name, o.granted_at AS since,
        (SELECT count(*)::int FROM events e WHERE e.organizer_id = o.user_id
           AND e.status = 'scheduled'
           AND e.ends_at < ${new Date(this.now()).toISOString()}::timestamptz) AS events
      FROM event_organizers o JOIN profiles p ON p.user_id = o.user_id
      ORDER BY o.granted_at`);
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      since: new Date(r.since).toISOString(),
      events: r.events,
    }));
  }

  async grant(adminId: string, email: string): Promise<{ userId: string }> {
    const [member] = await this.db
      .select({ id: user.id })
      .from(user)
      .innerJoin(profiles, eq(profiles.userId, user.id))
      .where(sql`lower(${user.email}) = lower(${email}) AND ${user.status} = 'active'`);
    if (!member) throw new HttpError(404, ErrorCode.NotFound, 'No active member with this email.');
    await this.db.transaction(async (tx) => {
      await tx
        .insert(eventOrganizers)
        .values({ userId: member.id, grantedBy: adminId })
        .onConflictDoNothing();
      await audit(tx, {
        actorId: adminId,
        action: 'organizer.granted',
        targetType: 'user',
        targetId: member.id,
      });
    });
    return { userId: member.id };
  }

  /**
   * Taking the role back: waiting proposals are declined, and upcoming events stay, run by staff,
   * without the organizer's name.
   */
  async revoke(adminId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(eventOrganizers)
        .where(eq(eventOrganizers.userId, userId))
        .returning({ userId: eventOrganizers.userId });
      if (removed.length === 0) throw notFound();
      const now = new Date(this.now());
      const declined = await tx
        .update(eventProposals)
        .set({
          status: 'declined',
          reason: 'The organizer role ended.',
          decidedBy: adminId,
          decidedAt: now,
        })
        .where(and(eq(eventProposals.organizerId, userId), eq(eventProposals.status, 'pending')))
        .returning({ id: eventProposals.id });
      const handedOver = await tx
        .update(events)
        .set({ organizerId: null })
        .where(and(eq(events.organizerId, userId), gt(events.endsAt, now)))
        .returning({ id: events.id });
      await audit(tx, {
        actorId: adminId,
        action: 'organizer.revoked',
        targetType: 'user',
        targetId: userId,
        meta: { declined: declined.length, events: handedOver.length },
      });
    });
  }

  async proposals(status: ProposalStatus = 'pending'): Promise<EventProposal[]> {
    const rows = await this.db
      .select({ p: eventProposals, v: venues, name: profiles.displayName })
      .from(eventProposals)
      .leftJoin(venues, eq(venues.id, eventProposals.venueId))
      .leftJoin(profiles, eq(profiles.userId, eventProposals.organizerId))
      .where(eq(eventProposals.status, status))
      .orderBy(eventProposals.startsAt)
      .limit(200);
    return rows.map((r) =>
      toProposal(r.p, r.v, { userId: r.p.organizerId, displayName: r.name ?? '' }),
    );
  }

  private async pending(id: string): Promise<ProposalRow> {
    const [row] = await this.db.select().from(eventProposals).where(eq(eventProposals.id, id));
    if (!row) throw notFound();
    if (row.status !== 'pending') {
      throw new HttpError(409, ErrorCode.Conflict, 'This proposal was already answered.');
    }
    return row;
  }

  /** Approving publishes the event as staff events are, with the organizer on it. */
  async approve(adminId: string, id: string): Promise<EventProposal> {
    const p = await this.pending(id);
    if (!(await this.isOrganizer(p.organizerId))) {
      throw new HttpError(409, ErrorCode.Conflict, 'This member is no longer an organizer.');
    }
    if (!p.venueId) throw invalid('The place of this proposal was removed.');
    const event = await this.events.create(adminId, {
      title: p.title,
      description: p.description,
      venueId: p.venueId,
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt.toISOString(),
      capacity: p.capacity,
    });
    await this.db.transaction(async (tx) => {
      await tx.update(events).set({ organizerId: p.organizerId }).where(eq(events.id, event.id));
      await tx
        .update(eventProposals)
        .set({
          status: 'approved',
          eventId: event.id,
          decidedBy: adminId,
          decidedAt: new Date(this.now()),
        })
        .where(eq(eventProposals.id, id));
      await audit(tx, {
        actorId: adminId,
        action: 'organizer.proposal_approved',
        targetType: 'event',
        targetId: event.id,
      });
    });
    return (await this.proposals('approved')).find((x) => x.id === id)!;
  }

  async decline(adminId: string, id: string, reason: string): Promise<void> {
    await this.pending(id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(eventProposals)
        .set({ status: 'declined', reason, decidedBy: adminId, decidedAt: new Date(this.now()) })
        .where(eq(eventProposals.id, id));
      await audit(tx, {
        actorId: adminId,
        action: 'organizer.proposal_declined',
        targetType: 'event_proposal',
        targetId: id,
      });
    });
  }
}
