import { checkHarm } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  DATE_MAX_DAYS_AHEAD,
  DATE_MIN_LEAD_MINUTES,
  DATE_PROPOSALS_PER_DAY,
  datePlanSummary,
  ErrorCode,
  type MessageView,
  type ProposeDateInput,
} from '@nexaheart/shared';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import { type ChatService, messageFlags } from '../chat/service.js';
import type { VenueService } from './venues.js';

const { datePlans, messages, matches } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
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

    // Retrying with the same clientId returns the card that was already sent.
    const [existing] = await this.db
      .select({ id: messages.id, matchId: messages.matchId })
      .from(messages)
      .where(and(eq(messages.senderId, userId), eq(messages.clientId, input.clientId)));
    if (existing) {
      if (existing.matchId !== matchId) {
        throw new HttpError(409, ErrorCode.Conflict, 'Message id already used.');
      }
      return this.chat.messageView(existing.id, userId);
    }

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
    const venue = await this.venues.active(input.venueId);
    if (!venue) throw notFound();

    const recent = await this.db.$count(
      datePlans,
      and(eq(datePlans.proposerId, userId), gt(datePlans.createdAt, new Date(now - 86_400_000))),
    );
    if (recent >= DATE_PROPOSALS_PER_DAY) {
      throw new HttpError(429, ErrorCode.RateLimited, 'Too many date ideas today.');
    }

    let messageId: string;
    try {
      messageId = await this.db.transaction(async (tx) => {
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
            clientId: input.clientId,
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
    await this.chat.deliverMessage(messageId, userId, otherId);
    return this.chat.messageView(messageId, userId);
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
}
