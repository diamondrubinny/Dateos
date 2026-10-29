// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  DATE_MAX_DAYS_AHEAD,
  DATE_MIN_LEAD_MINUTES,
  DATE_PROPOSALS_PER_DAY,
  datePlanSummary,
  AVAILABILITY_DAYS,
  ErrorCode,
  FEEDBACK_AFTER_MINUTES,
  parseSlot,
  type Availability,
  type DateFeedbackInput,
  type MessageView,
  type ProposeDateInput,
  type CounterDateInput,
  type Venue,
} from '@nexaheart/shared';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import { type ChatService, messageFlags } from '../chat/service.js';
import type { VenueService } from './venues.js';

const { datePlans, messages, matches, matchAvailability } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const stale = () =>
  new HttpError(409, ErrorCode.Conflict, 'This date idea can no longer be changed.');
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { cause?: { code?: string } }).cause?.code === '23505');

/**
 * Date ideas in a chat (phase 12). A proposal is a date card message; accepting, declining and
 * cancelling change the card for both people. Every action checks that the viewer is a participant
 * of the (still active, unblocked) match, through ChatService.participant.
 */
export class DateService {
  constructor(
    private readonly db: Database,
    private readonly chat: ChatService,
    private readonly venues: VenueService,
    private readonly now: () => number = Date.now,
  ) {}

  async propose(matchId: string, userId: string, input: ProposeDateInput): Promise<MessageView> {
    const { otherId } = await this.chat.participant(matchId, userId);
    const sent = await this.alreadySent(matchId, userId, input.clientId);
    if (sent) return sent;
    const { startsAt, note } = this.checkTimeAndNote(input);
    const venue = await this.venues.active(input.venueId);
    if (!venue) throw notFound();
    await this.checkDailyLimit(userId);
    await this.chat.checkConversationStart(matchId, userId);
    const messageId = await this.insertPlan(matchId, userId, input.clientId, venue, startsAt, note);
    await this.chat.deliverMessage(messageId, userId, otherId);
    return this.chat.messageView(messageId, userId);
  }

  /**
   * "Suggest another time" (phase 46): the person who received an open idea answers it with the
   * same place at another time. One transaction declines the idea (marked as countered) and sends
   * the new one, so the chat never has two open ideas, and a concurrent accept or withdraw wins once.
   */
  async counter(planId: string, userId: string, input: CounterDateInput): Promise<MessageView> {
    const loaded = await this.load(planId, userId);
    const { plan, otherId } = loaded;
    if (plan.proposerId === userId) {
      throw new HttpError(403, ErrorCode.Forbidden, 'You proposed this date.');
    }
    const sent = await this.alreadySent(plan.matchId, userId, input.clientId);
    if (sent) return sent;
    if (plan.status !== 'proposed') throw stale();
    const { startsAt, note } = this.checkTimeAndNote(input);
    if (startsAt.getTime() === plan.startsAt.getTime()) {
      throw new HttpError(422, ErrorCode.ValidationError, 'Pick a different time.');
    }
    // The place must still be on the community's list.
    const venue = plan.venueId ? await this.venues.active(plan.venueId) : null;
    if (!venue) throw notFound();
    await this.checkDailyLimit(userId);
    const messageId = await this.insertPlan(
      plan.matchId,
      userId,
      input.clientId,
      venue,
      startsAt,
      note,
      async (tx) => {
        const [declined] = await tx
          .update(datePlans)
          .set({ status: 'declined', countered: true, respondedAt: new Date(this.now()) })
          .where(and(eq(datePlans.id, plan.id), eq(datePlans.status, 'proposed')))
          .returning({ id: datePlans.id });
        if (!declined) throw stale();
      },
    );
    await this.chat.announceUpdated(plan.matchId, loaded.messageId, [userId, otherId]);
    await this.chat.deliverMessage(messageId, userId, otherId);
    return this.chat.messageView(messageId, userId);
  }

  /** Retrying with the same clientId returns the card that was already sent. */
  private async alreadySent(
    matchId: string,
    userId: string,
    clientId: string,
  ): Promise<MessageView | null> {
    const [existing] = await this.db
      .select({ id: messages.id, matchId: messages.matchId })
      .from(messages)
      .where(and(eq(messages.senderId, userId), eq(messages.clientId, clientId)));
    if (!existing) return null;
    if (existing.matchId !== matchId) {
      throw new HttpError(409, ErrorCode.Conflict, 'Message id already used.');
    }
    return this.chat.messageView(existing.id, userId);
  }

  private checkTimeAndNote(input: { startsAt: string; note?: string | undefined }): {
    startsAt: Date;
    note: string | null;
  } {
    const startsAt = new Date(input.startsAt);
    const now = this.now();
    if (
      startsAt.getTime() < now + DATE_MIN_LEAD_MINUTES * 60_000 ||
      startsAt.getTime() > now + DATE_MAX_DAYS_AHEAD * 86_400_000
    ) {
      throw new HttpError(
        422,
        ErrorCode.ValidationError,
        `Pick a time at least ${DATE_MIN_LEAD_MINUTES} minutes ahead and within ${DATE_MAX_DAYS_AHEAD} days.`,
      );
    }
    const note = input.note ? input.note : null;
    if (note && checkHarm(note).flagged) {
      throw new HttpError(
        422,
        ErrorCode.ValidationError,
        'This note may hurt. Please choose kinder words.',
      );
    }
    return { startsAt, note };
  }

  private async checkDailyLimit(userId: string): Promise<void> {
    const recent = await this.db.$count(
      datePlans,
      and(
        eq(datePlans.proposerId, userId),
        gt(datePlans.createdAt, new Date(this.now() - 86_400_000)),
      ),
    );
    if (recent >= DATE_PROPOSALS_PER_DAY) {
      throw new HttpError(429, ErrorCode.RateLimited, 'Too many date ideas today.');
    }
  }

  /** Inserts the plan (a copy of the place) and its card; `before` runs first in the same transaction. */
  private async insertPlan(
    matchId: string,
    userId: string,
    clientId: string,
    venue: Venue,
    startsAt: Date,
    note: string | null,
    before?: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<void>,
  ): Promise<string> {
    try {
      return await this.db.transaction(async (tx) => {
        await before?.(tx);
        const [plan] = await tx
          .insert(datePlans)
          .values({
            matchId,
            proposerId: userId,
            venueId: venue.id,
            venueName: venue.name,
            venueArea: venue.area,
            venueCategory: venue.category,
            venueAddress: venue.address,
            venueNote: venue.note,
            venueStepFree: venue.stepFree,
            startsAt,
            note,
          })
          .returning({ id: datePlans.id });
        const [message] = await tx
          .insert(messages)
          .values({
            matchId,
            senderId: userId,
            clientId,
            kind: 'date',
            body: datePlanSummary({
              venueName: venue.name,
              venueArea: venue.area,
              startsAt,
              note,
            }),
            datePlanId: plan!.id,
            // The note was harm-checked above; scam signals (links, money) still warn the receiver.
            flags: note ? messageFlags(note, 0).filter((f) => f.startsWith('scam:')) : [],
          })
          .returning({ id: messages.id });
        return message!.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          'There is already an open date idea in this chat.',
        );
      }
      throw error;
    }
  }

  /** The plan, its card and the other participant, for someone who is part of the chat. */
  private async load(planId: string, userId: string) {
    const [plan] = await this.db
      .select({ plan: datePlans, messageId: messages.id })
      .from(datePlans)
      .innerJoin(matches, eq(matches.id, datePlans.matchId))
      .innerJoin(messages, eq(messages.datePlanId, datePlans.id))
      .where(
        and(eq(datePlans.id, planId), or(eq(matches.userA, userId), eq(matches.userB, userId))),
      );
    if (!plan) throw notFound();
    const { otherId } = await this.chat.participant(plan.plan.matchId, userId);
    return { ...plan, otherId };
  }

  /** Moves the plan on only from the expected statuses (a concurrent change wins once). */
  private async finish(
    loaded: Awaited<ReturnType<DateService['load']>>,
    userId: string,
    status: 'accepted' | 'declined' | 'cancelled',
    from: ('proposed' | 'accepted')[],
    extra = sql`true`,
  ): Promise<MessageView> {
    const { plan, messageId, otherId } = loaded;
    const [updated] = await this.db
      .update(datePlans)
      .set({ status, respondedAt: new Date(this.now()) })
      .where(and(eq(datePlans.id, plan.id), inArray(datePlans.status, from), extra))
      .returning({ id: datePlans.id });
    if (!updated) {
      throw new HttpError(409, ErrorCode.Conflict, 'This date idea can no longer be changed.');
    }
    await this.chat.announceUpdated(plan.matchId, messageId, [userId, otherId]);
    return this.chat.messageView(messageId, userId);
  }

  /** Only the person who received the idea can accept or decline it. */
  async respond(
    planId: string,
    userId: string,
    answer: 'accept' | 'decline',
  ): Promise<MessageView> {
    const loaded = await this.load(planId, userId);
    if (loaded.plan.proposerId === userId) {
      throw new HttpError(403, ErrorCode.Forbidden, 'You proposed this date.');
    }
    if (answer === 'decline') return this.finish(loaded, userId, 'declined', ['proposed']);
    // An idea whose time has passed can't be accepted any more.
    return this.finish(
      loaded,
      userId,
      'accepted',
      ['proposed'],
      gt(datePlans.startsAt, new Date(this.now())),
    );
  }

  /**
   * The proposer can withdraw an open idea; either person can cancel an accepted date before it
   * starts.
   */
  async cancel(planId: string, userId: string): Promise<MessageView> {
    const loaded = await this.load(planId, userId);
    if (loaded.plan.status === 'proposed' && loaded.plan.proposerId !== userId) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Decline the idea instead.');
    }
    return this.finish(
      loaded,
      userId,
      'cancelled',
      ['proposed', 'accepted'],
      gt(datePlans.startsAt, new Date(this.now())),
    );
  }

  /**
   * "Did you meet?" (phase 20): each person's answer is private. The card updates for both, but the
   * other person only ever learns "you both want to meet again".
   */
  async feedback(planId: string, userId: string, input: DateFeedbackInput): Promise<MessageView> {
    const { plan, messageId, otherId } = await this.load(planId, userId);
    const due = plan.startsAt.getTime() + FEEDBACK_AFTER_MINUTES * 60_000;
    if (plan.status !== 'accepted' || this.now() < due) {
      throw new HttpError(409, ErrorCode.Conflict, 'You can answer after the date.');
    }
    const proposer = plan.proposerId === userId;
    await this.db
      .update(datePlans)
      .set(
        proposer
          ? { proposerMet: input.met, proposerAgain: input.again }
          : { receiverMet: input.met, receiverAgain: input.again },
      )
      .where(eq(datePlans.id, plan.id));
    await this.chat.announceUpdated(plan.matchId, messageId, [userId, otherId]);
    return this.chat.messageView(messageId, userId);
  }

  // ---------------------------------------------------------------- availability (phase 20)

  /** Slots from today (UTC, a day of slack for time zones) up to AVAILABILITY_DAYS ahead. */
  private window(): { from: string; to: string } {
    const day = (offset: number) =>
      new Date(this.now() + offset * 86_400_000).toISOString().slice(0, 10);
    return { from: day(-1), to: day(AVAILABILITY_DAYS) };
  }

  async availability(matchId: string, userId: string): Promise<Availability> {
    const { otherId } = await this.chat.participant(matchId, userId);
    const rows = await this.db
      .select({ userId: matchAvailability.userId, slots: matchAvailability.slots })
      .from(matchAvailability)
      .where(eq(matchAvailability.matchId, matchId));
    const { from } = this.window();
    const current = (slots: string[] | undefined) =>
      (slots ?? []).filter((s) => parseSlot(s).date >= from).sort();
    const mine = current(rows.find((r) => r.userId === userId)?.slots);
    const theirs = current(rows.find((r) => r.userId === otherId)?.slots);
    return {
      mine,
      theyShared: theirs.length > 0,
      // Only the overlap: the other person's other times stay private.
      overlap: mine.filter((s) => theirs.includes(s)),
    };
  }

  async setAvailability(matchId: string, userId: string, slots: string[]): Promise<Availability> {
    const { otherId } = await this.chat.participant(matchId, userId);
    const { from, to } = this.window();
    for (const slot of slots) {
      const { date } = parseSlot(slot);
      if (date < from || date > to || Number.isNaN(Date.parse(date))) {
        throw new HttpError(400, ErrorCode.ValidationError, 'Choose times in the next two weeks.');
      }
    }
    const values = { slots, updatedAt: new Date(this.now()) };
    await this.db
      .insert(matchAvailability)
      .values({ matchId, userId, ...values })
      .onConflictDoUpdate({
        target: [matchAvailability.matchId, matchAvailability.userId],
        set: values,
      });
    // Let the other person's chat refresh its overlap.
    this.chat.notifyAvailability(matchId, [otherId]);
    return this.availability(matchId, userId);
  }
}
