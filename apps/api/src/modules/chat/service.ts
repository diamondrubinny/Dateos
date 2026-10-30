// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm, detectScamSignals, type IcebreakerProvider } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  type CallView,
  type Conversation,
  ErrorCode,
  harmCategories,
  type Locale,
  MESSAGES_BEFORE_IMAGES,
  type MessagesPage,
  type MessageView,
  type ChatSearchResult,
  type TranscriptLang,
  type PromptKey,
  scamSignals,
  FEEDBACK_AFTER_MINUTES,
  type AgainAnswer,
  reactionEmojis,
  REPLY_PREVIEW_LENGTH,
  UNSEND_MINUTES,
  type ReactionEmoji,
  type DateFeedbackView,
  NEW_ACCOUNT_CHAT_STARTS,
  MAX_PINNED_CHATS,
} from '@nexaheart/shared';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { audit } from '../../lib/audit.js';
import { normalize, normalizedText, openAutoReport } from '../safety/auto-report.js';
import type { Realtime } from '../../lib/realtime.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { DiscoveryService } from '../discovery/service.js';
import { photoUrl } from '../me/service.js';
import type { PhotoService } from '../photos/service.js';
import type { AudioService } from './audio.js';

const {
  messages,
  messageReactions,
  matches,
  matchReads,
  matchPrefs,
  photos,
  profiles,
  prompts,
  audioClips,
  preferences,
  datePlans,
  calls,
} = schema;

type MessageRow = typeof messages.$inferSelect & {
  photoStatus: string | null;
  audioStatus: string | null;
  audioDurationMs: number | null;
  plan: typeof datePlans.$inferSelect | null;
  call: typeof calls.$inferSelect | null;
  /** Phase 29b: who reacted with what (at most one each). */
  reactions?: { userId: string; emoji: string }[] | null;
  /** Phase 30: the quoted message. */
  reply?: {
    id: string | null;
    senderId: string | null;
    kind: MessageView['kind'] | null;
    body: string | null;
    flags: string[] | null;
    unsentAt: Date | null;
  } | null;
};

/** What a viewer may see of a quoted message (phase 30). */
function replyView(reply: MessageRow['reply'], viewerId: string): MessageView['replyTo'] {
  if (!reply?.id || !reply.senderId || !reply.kind) return null;
  const mine = reply.senderId === viewerId;
  const harmful = (reply.flags ?? []).some((f) => f.startsWith('harm:'));
  const state = reply.unsentAt ? 'unsent' : harmful && !mine ? 'hidden' : 'shown';
  return {
    id: reply.id,
    mine,
    kind: reply.kind,
    preview:
      state === 'shown' && reply.kind === 'text' && reply.body
        ? reply.body.slice(0, REPLY_PREVIEW_LENGTH)
        : null,
    state,
  };
}

const asReaction = (emoji: string | undefined): ReactionEmoji | null =>
  emoji && (reactionEmojis as readonly string[]).includes(emoji) ? (emoji as ReactionEmoji) : null;

/** A receiver sees media only after it passed scanning; senders see their own uploads. */
const visibleTo = (viewerId: string) =>
  sql`(${messages.kind} IN ('text', 'date', 'call') OR ${messages.senderId} = ${viewerId} OR ${photos.status} = 'clean' OR ${audioClips.status} = 'clean')`;

/** Phase 34: the same text (this long or more) to this many chats in 24 hours is reported. */
export const SAME_MESSAGE_MIN_LENGTH = 15;
export const SAME_MESSAGE_CHATS = 5;
/** Phase 34: scam signals from an account under 24 hours old in this many chats. */
export const NEW_ACCOUNT_SCAM_CHATS = 3;

/** The quoted message of a reply (phase 30). */
const replied = alias(messages, 'replied');

/** A photo or voice message that isn't clean yet: its receiver doesn't see it. */
const isPendingMedia = (view: MessageView) =>
  (view.image !== null && view.image.status !== 'clean') ||
  (view.voice !== null && view.voice.status !== 'clean');

const mediaStatus = (status: string | null) =>
  status === 'clean'
    ? ('clean' as const)
    : status === 'rejected'
      ? ('rejected' as const)
      : ('pending' as const);

/** A call as one of its two participants sees it. */
export function callView(call: typeof calls.$inferSelect, viewerId: string): CallView {
  const endsAt = call.answeredAt
    ? new Date(call.answeredAt.getTime() + call.maxMinutes * 60_000)
    : null;
  return {
    id: call.id,
    matchId: call.matchId,
    status: call.status,
    video: call.video,
    mine: call.callerId === viewerId,
    createdAt: call.createdAt.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    endsAt: call.status === 'active' && endsAt ? endsAt.toISOString() : null,
    durationSeconds:
      call.answeredAt && call.endedAt
        ? Math.max(0, Math.round((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000))
        : null,
  };
}

export function audioUrl(audioId: string): string {
  return `/v1/audio/${audioId}`;
}

export interface ChatNotifier {
  /** Push notification to a person who received a message (no content is sent). */
  messageReceived(userId: string, matchId: string): Promise<void>;
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

export function messageFlags(text: string, messagesSoFar: number): string[] {
  const harm = checkHarm(text);
  return [
    ...harm.categories.map((c) => `harm:${c}`),
    ...detectScamSignals(text, messagesSoFar).map((s) => `scam:${s}`),
  ];
}

/**
 * "Did you meet?" on an accepted date (phase 20). Each person sees only their own answers, and
 * "you both want to meet again" once both said yes; never the other person's no.
 */
export function feedbackView(
  plan: typeof datePlans.$inferSelect,
  viewerId: string,
  now = Date.now(),
): DateFeedbackView | null {
  if (plan.status !== 'accepted') return null;
  const proposer = plan.proposerId === viewerId;
  const met = proposer ? plan.proposerMet : plan.receiverMet;
  const again = (proposer ? plan.proposerAgain : plan.receiverAgain) as AgainAnswer | null;
  return {
    canGive: now >= plan.startsAt.getTime() + FEEDBACK_AFTER_MINUTES * 60_000,
    mine: met === null ? null : { met, again },
    bothAgain: plan.proposerAgain === 'yes' && plan.receiverAgain === 'yes',
  };
}

/** What a given participant sees. Harmful messages arrive hidden for the receiver only. */
export function toView(row: MessageRow, viewerId: string, now = Date.now()): MessageView {
  const mine = row.senderId === viewerId;
  // Unsent (phase 30): nothing of it reaches either person; the server keeps it for moderation.
  if (row.unsentAt) {
    return {
      id: row.id,
      matchId: row.matchId,
      mine,
      kind: row.kind,
      body: null,
      image: null,
      voice: null,
      date: null,
      call: null,
      hidden: false,
      harm: [],
      scam: [],
      reactions: { mine: null, theirs: null },
      unsent: true,
      replyTo: null,
      createdAt: row.createdAt.toISOString(),
    };
  }
  const harm = harmCategories.filter((c) => row.flags.includes(`harm:${c}`));
  const scam = scamSignals.filter((s) => row.flags.includes(`scam:${s}`));
  const status = mediaStatus(row.photoStatus);
  const voiceStatus = mediaStatus(row.audioStatus);
  return {
    id: row.id,
    matchId: row.matchId,
    mine,
    kind: row.kind,
    body: row.body,
    image:
      row.kind === 'image'
        ? { url: status === 'clean' && row.photoId ? photoUrl(row.photoId) : null, status }
        : null,
    voice:
      row.kind === 'voice'
        ? {
            url: voiceStatus === 'clean' && row.audioId ? audioUrl(row.audioId) : null,
            status: voiceStatus,
            durationMs: row.audioDurationMs,
          }
        : null,
    date:
      row.kind === 'date' && row.plan
        ? {
            id: row.plan.id,
            status: row.plan.status,
            mine: row.plan.proposerId === viewerId,
            venue: {
              name: row.plan.venueName,
              area: row.plan.venueArea,
              category: row.plan.venueCategory,
              address: row.plan.venueAddress,
              note: row.plan.venueNote,
              stepFree: row.plan.venueStepFree,
            },
            startsAt: row.plan.startsAt.toISOString(),
            note: row.plan.note,
            respondedAt: row.plan.respondedAt?.toISOString() ?? null,
            countered: row.plan.countered,
            feedback: feedbackView(row.plan, viewerId, now),
          }
        : null,
    call: row.kind === 'call' && row.call ? callView(row.call, viewerId) : null,
    hidden: !mine && harm.length > 0,
    harm,
    scam: mine ? [] : scam,
    reactions: {
      mine: asReaction(row.reactions?.find((r) => r.userId === viewerId)?.emoji),
      theirs: asReaction(row.reactions?.find((r) => r.userId !== viewerId)?.emoji),
    },
    unsent: false,
    replyTo: replyView(row.reply, viewerId),
    createdAt: row.createdAt.toISOString(),
  };
}

export class ChatService {
  constructor(
    private readonly db: Database,
    private readonly realtime: Realtime,
    private readonly discovery: DiscoveryService,
    private readonly photos: PhotoService,
    /** Picks the icebreaker provider for a conversation (consent of both people for external AI). */
    private readonly icebreakers:
      IcebreakerProvider | ((a: string, b: string) => Promise<IcebreakerProvider>),
    private readonly audio?: AudioService,
    private readonly notifier?: ChatNotifier,
    /** The clock for time-based card states ("did you meet?"); tests move it. */
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether a realtime connection may keep receiving events for this session. */
  async sessionActive(sessionId: string, userId: string): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      SELECT 1 FROM session s JOIN "user" u ON u.id = s.user_id
      WHERE s.id = ${sessionId} AND s.user_id = ${userId} AND s.expires_at > now()
        AND u.status <> 'suspended'`);
    return rows.length > 0;
  }

  /** The active match and the other participant, or 404 for anyone else. */
  async participant(matchId: string, viewerId: string): Promise<{ otherId: string }> {
    const [match] = await this.db
      .select({ userA: matches.userA, userB: matches.userB })
      .from(matches)
      .where(
        and(
          eq(matches.id, matchId),
          isNull(matches.unmatchedAt),
          or(eq(matches.userA, viewerId), eq(matches.userB, viewerId)),
        ),
      );
    if (!match) throw notFound();
    const otherId = match.userA === viewerId ? match.userB : match.userA;
    if (!(await this.discovery.canView(viewerId, otherId))) throw notFound(); // blocked or suspended
    return { otherId };
  }

  private rows(where: ReturnType<typeof and>) {
    return this.db
      .select({
        id: messages.id,
        matchId: messages.matchId,
        senderId: messages.senderId,
        clientId: messages.clientId,
        kind: messages.kind,
        body: messages.body,
        photoId: messages.photoId,
        audioId: messages.audioId,
        flags: messages.flags,
        unsentAt: messages.unsentAt,
        replyToId: messages.replyToId,
        createdAt: messages.createdAt,
        photoStatus: photos.status,
        audioStatus: audioClips.status,
        audioDurationMs: audioClips.durationMs,
        datePlanId: messages.datePlanId,
        callId: messages.callId,
        plan: datePlans,
        call: calls,
        reactions: sql<{ userId: string; emoji: string }[] | null>`(
          SELECT json_agg(json_build_object('userId', r.user_id, 'emoji', r.emoji))
          FROM message_reactions r WHERE r.message_id = "messages"."id")`,
        reply: {
          id: replied.id,
          senderId: replied.senderId,
          kind: replied.kind,
          body: replied.body,
          flags: replied.flags,
          unsentAt: replied.unsentAt,
        },
      })
      .from(messages)
      .leftJoin(replied, eq(replied.id, messages.replyToId))
      .leftJoin(photos, eq(photos.id, messages.photoId))
      .leftJoin(audioClips, eq(audioClips.id, messages.audioId))
      .leftJoin(datePlans, eq(datePlans.id, messages.datePlanId))
      .leftJoin(calls, eq(calls.id, messages.callId))
      .where(where);
  }

  /** One message as a participant sees it (used by the date planner after it writes a card). */
  async messageView(messageId: string, viewerId: string): Promise<MessageView> {
    const [row] = await this.rows(eq(messages.id, messageId));
    if (!row) throw notFound();
    return toView(row, viewerId, this.now());
  }

  /** Tells both people about a new message, with a content-free push to the receiver. */
  async deliverMessage(
    messageId: string,
    senderId: string,
    otherId: string,
    { push = true }: { push?: boolean } = {},
  ): Promise<void> {
    const [row] = await this.rows(eq(messages.id, messageId));
    if (row) await this.deliver(row, senderId, otherId, push);
  }

  /** Calls (phase 15) tell the chat whether a call can be started; set once at startup. */
  setCallAvailability(
    check: (matchId: string, viewerId: string, otherId: string) => Promise<boolean>,
  ) {
    this.callsAvailable = check;
  }
  private callsAvailable: (matchId: string, viewerId: string, otherId: string) => Promise<boolean> =
    async () => false;

  /** A message changed (for example a date card was accepted); clients reload the chat. */
  async announceUpdated(matchId: string, messageId: string, userIds: string[]): Promise<void> {
    await Promise.all(
      userIds.map((userId) =>
        this.realtime.publish(userId, { type: 'message.updated', matchId, messageId }),
      ),
    );
  }

  notifyAvailability(matchId: string, userIds: string[]): void {
    for (const userId of userIds) {
      void this.realtime
        .publish(userId, { type: 'availability.updated', matchId })
        .catch(() => undefined);
    }
  }

  private async counts(matchId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ senderId: messages.senderId, n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.matchId, matchId), eq(messages.kind, 'text')))
      .groupBy(messages.senderId);
    return new Map(rows.map((r) => [r.senderId, r.n]));
  }

  /** Images, voice messages and calls unlock after both people wrote a few messages. */
  async mediaUnlocked(matchId: string, a: string, b: string): Promise<boolean> {
    return this.imagesUnlocked(matchId, a, b);
  }

  private async imagesUnlocked(matchId: string, a: string, b: string): Promise<boolean> {
    const counts = await this.counts(matchId);
    return (
      (counts.get(a) ?? 0) >= MESSAGES_BEFORE_IMAGES &&
      (counts.get(b) ?? 0) >= MESSAGES_BEFORE_IMAGES
    );
  }

  async list(
    matchId: string,
    viewerId: string,
    before: string | undefined,
    limit: number,
  ): Promise<MessagesPage> {
    const { otherId } = await this.participant(matchId, viewerId);
    const conditions = [eq(messages.matchId, matchId)];
    if (before) conditions.push(lt(messages.createdAt, new Date(before)));
    conditions.push(visibleTo(viewerId));
    const rows = await this.rows(and(...conditions))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const [read] = await this.db
      .select({ at: matchReads.lastReadAt })
      .from(matchReads)
      .where(and(eq(matchReads.matchId, matchId), eq(matchReads.userId, otherId)));
    // Read receipts (phase 30) are shown only when both people have them on.
    const receipts = await this.readReceipts(viewerId, otherId);
    return {
      messages: page.reverse().map((r) => toView(r, viewerId, this.now())),
      before: rows.length > limit ? page[0]!.createdAt.toISOString() : null,
      otherReadAt: receipts ? (read?.at.toISOString() ?? null) : null,
      imagesUnlocked: await this.imagesUnlocked(matchId, viewerId, otherId),
      otherAcceptsVoice: await this.acceptsVoice(otherId),
      callsAvailable: await this.callsAvailable(matchId, viewerId, otherId),
      writeNeedsVerification: await this.writeNeedsVerification(matchId, viewerId, otherId),
    };
  }

  /**
   * Phase 65: the receiver accepts messages from verified members only, the sender isn't verified,
   * and the receiver hasn't written in this chat yet.
   */
  private async writeNeedsVerification(
    matchId: string,
    senderId: string,
    otherId: string,
  ): Promise<boolean> {
    const { rows } = await this.db.execute<{ blocked: boolean }>(sql`
      SELECT COALESCE((SELECT verified_contact_only FROM preferences WHERE user_id = ${otherId}), false)
        AND (SELECT verified_at IS NULL FROM profiles WHERE user_id = ${senderId})
        AND NOT EXISTS (SELECT 1 FROM messages WHERE match_id = ${matchId} AND sender_id = ${otherId})
        AS blocked`);
    return rows[0]?.blocked ?? false;
  }

  private async requireMayWrite(matchId: string, senderId: string, otherId: string) {
    if (await this.writeNeedsVerification(matchId, senderId, otherId)) {
      throw new HttpError(
        403,
        ErrorCode.VerifiedOnly,
        'This person accepts messages from verified members only. Verify your photos to write.',
      );
    }
  }

  private async acceptsVoice(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ accept: preferences.acceptVoice })
      .from(preferences)
      .where(eq(preferences.userId, userId));
    return row?.accept ?? true;
  }

  /** Voice messages: same unlock rule as images, and only if the receiver accepts them. */
  async sendVoice(
    matchId: string,
    senderId: string,
    buffer: Buffer,
    lang?: TranscriptLang,
  ): Promise<MessageView> {
    if (!this.audio)
      throw new HttpError(503, ErrorCode.ServiceUnavailable, 'Voice messages are unavailable.');
    const { otherId } = await this.participant(matchId, senderId);
    if (!(await this.imagesUnlocked(matchId, senderId, otherId))) {
      throw new HttpError(
        403,
        ErrorCode.Forbidden,
        `Voice messages unlock after you both sent ${MESSAGES_BEFORE_IMAGES} messages.`,
      );
    }
    if (!(await this.acceptsVoice(otherId))) {
      throw new HttpError(403, ErrorCode.Forbidden, 'This person does not accept voice messages.');
    }
    await this.requireMayWrite(matchId, senderId, otherId);
    const clip = await this.audio.upload(senderId, buffer, undefined, lang);
    const clientId = `voice-${randomUUID()}`;
    await this.db
      .insert(messages)
      .values({ matchId, senderId, clientId, kind: 'voice', audioId: clip.id });
    const [row] = await this.rows(
      and(eq(messages.senderId, senderId), eq(messages.clientId, clientId)),
    );
    // Like images: the receiver is told once the worker has scanned and re-encoded it.
    await this.realtime.publish(senderId, {
      type: 'message.new',
      matchId,
      message: toView(row!, senderId, this.now()),
    });
    return toView(row!, senderId, this.now());
  }

  async openAudio(viewerId: string, audioId: string, format: 'aac' | 'opus' = 'aac') {
    if (!this.audio) throw notFound();
    return this.audio.open(viewerId, audioId, format);
  }

  /** Idempotent: re-sending the same clientId returns the original message. */
  /**
   * A gentle start (phase 36): an account less than a day old may start only a few conversations a
   * day. Only the first message of a chat counts; replies and later messages are never limited.
   */
  async checkConversationStart(matchId: string, senderId: string): Promise<void> {
    const { rows } = await this.db.execute<{ first: boolean; fresh: boolean }>(sql`
      SELECT NOT EXISTS (SELECT 1 FROM messages WHERE match_id = ${matchId}) AS first,
        u.created_at > now() - interval '24 hours' AS fresh
      FROM "user" u WHERE u.id = ${senderId}`);
    if (!rows[0]?.first || !rows[0].fresh) return;
    const { rows: started } = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM matches m
      JOIN LATERAL (
        SELECT x.sender_id, x.created_at FROM messages x WHERE x.match_id = m.id
        ORDER BY x.created_at, x.id LIMIT 1
      ) opener ON true
      WHERE (m.user_a = ${senderId} OR m.user_b = ${senderId})
        AND opener.sender_id = ${senderId}
        AND opener.created_at > now() - interval '24 hours'`);
    if ((started[0]?.n ?? 0) >= NEW_ACCOUNT_CHAT_STARTS) {
      throw new HttpError(
        429,
        ErrorCode.SlowDown,
        'New accounts can start a few conversations a day; replies are not limited.',
      );
    }
  }

  async send(
    matchId: string,
    senderId: string,
    text: string,
    clientId: string,
    replyToId?: string,
  ): Promise<MessageView> {
    const { otherId } = await this.participant(matchId, senderId);
    // A reply quotes a message of this chat only, so it can't reveal another conversation.
    if (replyToId) {
      const [quoted] = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.id, replyToId), eq(messages.matchId, matchId)));
      if (!quoted) {
        throw new HttpError(400, ErrorCode.ValidationError, 'You can only reply to this chat.');
      }
    }
    await this.checkConversationStart(matchId, senderId);
    await this.requireMayWrite(matchId, senderId, otherId);
    const total = [...(await this.counts(matchId)).values()].reduce((a, b) => a + b, 0);
    const inserted = await this.db
      .insert(messages)
      .values({
        matchId,
        senderId,
        clientId,
        kind: 'text',
        body: text,
        flags: messageFlags(text, total),
        replyToId: replyToId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    const [row] = await this.rows(
      and(eq(messages.senderId, senderId), eq(messages.clientId, clientId)),
    );
    if (!row || row.matchId !== matchId)
      throw new HttpError(409, ErrorCode.Conflict, 'Message id already used.');
    if (inserted.length > 0) {
      await this.deliver(row, senderId, otherId);
      // Bot behaviour (phase 34): checked after delivery, never delaying or blocking the message.
      void this.botChecks(senderId, text, row.flags).catch(() => undefined);
    }
    return toView(row, senderId, this.now());
  }

  /**
   * Phase 34: the same text to many chats, and scam signals from a brand-new account. Each opens
   * an automatic report for a moderator (at most one open per account and category).
   */
  async botChecks(senderId: string, text: string, flags: string[]): Promise<void> {
    const body = normalize(text);
    if (body.length >= SAME_MESSAGE_MIN_LENGTH) {
      const [{ chats }] = (await this.db
        .select({ chats: sql<number>`count(DISTINCT ${messages.matchId})::int` })
        .from(messages)
        .where(
          and(
            eq(messages.senderId, senderId),
            eq(messages.kind, 'text'),
            sql`${messages.createdAt} > now() - interval '24 hours'`,
            sql`${normalizedText(messages.body)} = ${body}`,
          ),
        )) as [{ chats: number }];
      if (chats >= SAME_MESSAGE_CHATS) {
        await openAutoReport(this.db, senderId, 'spam', 'normal', 'same_message');
      }
    }
    if (flags.some((f) => f.startsWith('scam:'))) {
      const [{ fresh, chats }] = (
        await this.db.execute<{ fresh: boolean; chats: number }>(sql`
        SELECT (SELECT created_at > now() - interval '24 hours' FROM "user" WHERE id = ${senderId}) AS fresh,
               (SELECT count(DISTINCT match_id)::int FROM messages
                WHERE sender_id = ${senderId} AND created_at > now() - interval '24 hours'
                  AND EXISTS (SELECT 1 FROM unnest(flags) f WHERE f LIKE 'scam:%')) AS chats`)
      ).rows as [{ fresh: boolean; chats: number }];
      if (fresh && chats >= NEW_ACCOUNT_SCAM_CHATS) {
        await openAutoReport(this.db, senderId, 'scam', 'high', 'new_account_scam');
      }
    }
  }

  /**
   * React to a message, or remove my reaction (phase 29b). Only in an active match, only on a
   * message the other person can see whole: not one hidden by the harm filter. The other person
   * sees it live; there is no push notification.
   */
  async react(
    matchId: string,
    messageId: string,
    viewerId: string,
    emoji: ReactionEmoji | null,
  ): Promise<MessageView> {
    const { otherId } = await this.participant(matchId, viewerId);
    const [row] = await this.rows(and(eq(messages.id, messageId), eq(messages.matchId, matchId)));
    if (!row) throw notFound();
    const view = toView(row, viewerId, this.now());
    // A receiver can't see a hidden message (or media still being scanned), so can't react to it.
    if (row.flags.some((f) => f.startsWith('harm:')) || (!view.mine && isPendingMedia(view))) {
      throw new HttpError(409, ErrorCode.Conflict, 'This message can’t have reactions.');
    }
    if (emoji === null) {
      await this.db
        .delete(messageReactions)
        .where(
          and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, viewerId)),
        );
    } else {
      await this.db
        .insert(messageReactions)
        .values({ messageId, userId: viewerId, emoji })
        .onConflictDoUpdate({
          target: [messageReactions.messageId, messageReactions.userId],
          set: { emoji, createdAt: new Date() },
        });
    }
    await this.announceUpdated(matchId, messageId, [viewerId, otherId]);
    return this.messageView(messageId, viewerId);
  }

  async sendImage(matchId: string, senderId: string, buffer: Buffer): Promise<MessageView> {
    const { otherId } = await this.participant(matchId, senderId);
    if (!(await this.imagesUnlocked(matchId, senderId, otherId))) {
      throw new HttpError(
        403,
        ErrorCode.Forbidden,
        `Images unlock after you both sent ${MESSAGES_BEFORE_IMAGES} messages.`,
      );
    }
    await this.requireMayWrite(matchId, senderId, otherId);
    const photo = await this.photos.upload(senderId, buffer, 'chat');
    const clientId = `img-${randomUUID()}`;
    await this.db
      .insert(messages)
      .values({ matchId, senderId, clientId, kind: 'image', photoId: photo.id });
    const [row] = await this.rows(
      and(eq(messages.senderId, senderId), eq(messages.clientId, clientId)),
    );
    // The receiver is told only once the worker has scanned the image (message.updated).
    await this.realtime.publish(senderId, {
      type: 'message.new',
      matchId,
      message: toView(row!, senderId, this.now()),
    });
    return toView(row!, senderId, this.now());
  }

  private async deliver(row: MessageRow, senderId: string, otherId: string, push = true) {
    // A new message brings an archived chat back for its receiver (phase 31).
    await this.db
      .update(matchPrefs)
      .set({ archived: false })
      .where(
        and(
          eq(matchPrefs.matchId, row.matchId),
          eq(matchPrefs.userId, otherId),
          eq(matchPrefs.archived, true),
        ),
      );
    if (push) this.notifier?.messageReceived(otherId, row.matchId).catch(() => undefined);
    await Promise.all([
      this.realtime.publish(senderId, {
        type: 'message.new',
        matchId: row.matchId,
        message: toView(row, senderId, this.now()),
      }),
      this.realtime.publish(otherId, {
        type: 'message.new',
        matchId: row.matchId,
        message: toView(row, otherId, this.now()),
      }),
    ]);
  }

  async markRead(matchId: string, viewerId: string): Promise<void> {
    const { otherId } = await this.participant(matchId, viewerId);
    const at = new Date();
    await this.db
      .insert(matchReads)
      .values({ matchId, userId: viewerId, lastReadAt: at })
      .onConflictDoUpdate({
        target: [matchReads.matchId, matchReads.userId],
        set: { lastReadAt: at },
      });
    // My unread count still updates; "Seen" goes out only when both people allow it (phase 30).
    if (await this.readReceipts(viewerId, otherId)) {
      await this.realtime.publish(otherId, { type: 'message.read', matchId, at: at.toISOString() });
    }
  }

  /** True when both people share read receipts (phase 30); a missing row means the default, on. */
  private async readReceipts(a: string, b: string): Promise<boolean> {
    const rows = await this.db
      .select({ on: preferences.readReceipts })
      .from(preferences)
      .where(
        and(
          or(eq(preferences.userId, a), eq(preferences.userId, b)),
          eq(preferences.readReceipts, false),
        ),
      );
    return rows.length === 0;
  }

  /**
   * Unsend my own message (phase 30): within UNSEND_MINUTES, text, photo or voice only. It's
   * hidden from both people at once, but kept UNSENT_KEEP_DAYS for moderation (a report from the
   * other person adds it as evidence), then purged by the worker.
   */
  async unsend(matchId: string, messageId: string, viewerId: string): Promise<MessageView> {
    const { otherId } = await this.participant(matchId, viewerId);
    const [row] = await this.db
      .select({
        senderId: messages.senderId,
        kind: messages.kind,
        unsentAt: messages.unsentAt,
        // The database's clock, the same one that dated the message.
        inTime: sql<boolean>`${messages.createdAt} > now() - make_interval(mins => ${UNSEND_MINUTES})`,
      })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.matchId, matchId)));
    // Someone else's message looks like one that doesn't exist.
    if (!row || row.senderId !== viewerId) throw notFound();
    if (!row.unsentAt) {
      if (!['text', 'image', 'voice'].includes(row.kind)) {
        throw new HttpError(409, ErrorCode.Conflict, 'This message can’t be unsent.');
      }
      if (!row.inTime) {
        throw new HttpError(409, ErrorCode.Conflict, 'It’s too late to unsend this message.');
      }
      await this.db.transaction(async (tx) => {
        await tx
          .update(messages)
          .set({ unsentAt: sql`now()` })
          .where(and(eq(messages.id, messageId), isNull(messages.unsentAt)));
        await tx.delete(messageReactions).where(eq(messageReactions.messageId, messageId));
        await audit(tx, {
          actorId: viewerId,
          action: 'message.unsent',
          targetType: 'message',
          targetId: messageId,
        });
      });
      await this.announceUpdated(matchId, messageId, [viewerId, otherId]);
    }
    return this.messageView(messageId, viewerId);
  }

  async typing(matchId: string, viewerId: string): Promise<void> {
    const { otherId } = await this.participant(matchId, viewerId);
    await this.realtime.publish(otherId, { type: 'typing', matchId });
  }

  /** Matches with their latest message and unread count, newest activity first. */
  /**
   * Search my chat (phase 32): text messages containing the words, newest first. Never unsent
   * messages, and never ones hidden from me by the harm filter. The terms aren't logged.
   */
  async search(matchId: string, viewerId: string, q: string): Promise<ChatSearchResult> {
    await this.participant(matchId, viewerId);
    // LIKE wildcards in the terms are matched literally.
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.matchId, matchId),
          eq(messages.kind, 'text'),
          isNull(messages.unsentAt),
          sql`${messages.body} ILIKE ${pattern}`,
          // Harmful messages from the other person stay hidden here too.
          sql`(${messages.senderId} = ${viewerId} OR NOT EXISTS (SELECT 1 FROM unnest(${messages.flags}) f WHERE f LIKE 'harm:%'))`,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(20);
    return {
      results: rows.map((r) => ({
        id: r.id,
        mine: r.senderId === viewerId,
        body: r.body ?? '',
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Mute, archive or pin a chat, privately (phases 31, 38). Pinning brings an archived chat back;
   * archiving unpins. At most MAX_PINNED_CHATS pinned at once.
   */
  async setPrefs(
    matchId: string,
    viewerId: string,
    input: {
      muted?: boolean | undefined;
      archived?: boolean | undefined;
      pinned?: boolean | undefined;
    },
  ): Promise<{ muted: boolean; archived: boolean; pinned: boolean }> {
    await this.participant(matchId, viewerId);
    return this.db.transaction(async (tx) => {
      // One member's pins are decided one at a time, so two quick taps can't pass the limit.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pins:${viewerId}`}))`);
      const set: Partial<typeof matchPrefs.$inferInsert> = {};
      if (input.muted !== undefined) set.muted = input.muted;
      if (input.archived !== undefined) set.archived = input.archived;
      if (input.archived === true) set.pinnedAt = null;
      if (input.pinned === false) set.pinnedAt = null;
      if (input.pinned === true && input.archived !== true) {
        const [current] = await tx
          .select({ pinnedAt: matchPrefs.pinnedAt })
          .from(matchPrefs)
          .where(and(eq(matchPrefs.matchId, matchId), eq(matchPrefs.userId, viewerId)));
        if (!current?.pinnedAt) {
          const [{ n }] = (await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(matchPrefs)
            .innerJoin(matches, eq(matches.id, matchPrefs.matchId))
            .where(
              and(
                eq(matchPrefs.userId, viewerId),
                sql`${matchPrefs.pinnedAt} IS NOT NULL`,
                isNull(matches.unmatchedAt),
              ),
            )) as [{ n: number }];
          if (n >= MAX_PINNED_CHATS) {
            throw new HttpError(409, ErrorCode.Conflict, 'Unpin a chat first.');
          }
          set.pinnedAt = new Date(this.now());
        }
        set.archived = false;
      }
      const [row] = await tx
        .insert(matchPrefs)
        .values({ matchId, userId: viewerId, ...set })
        .onConflictDoUpdate({ target: [matchPrefs.matchId, matchPrefs.userId], set })
        .returning({
          muted: matchPrefs.muted,
          archived: matchPrefs.archived,
          pinnedAt: matchPrefs.pinnedAt,
        });
      return { muted: row!.muted, archived: row!.archived, pinned: row!.pinnedAt !== null };
    });
  }

  async inbox(viewerId: string): Promise<Conversation[]> {
    const summaries = await this.discovery.matches(viewerId);
    const prefs = new Map(
      (
        await this.db
          .select({
            matchId: matchPrefs.matchId,
            muted: matchPrefs.muted,
            archived: matchPrefs.archived,
            pinnedAt: matchPrefs.pinnedAt,
          })
          .from(matchPrefs)
          .where(eq(matchPrefs.userId, viewerId))
      ).map((p) => [p.matchId, p]),
    );
    const out: Conversation[] = [];
    for (const m of summaries) {
      const [last] = await this.rows(and(eq(messages.matchId, m.id), visibleTo(viewerId)))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      const [read] = await this.db
        .select({ at: matchReads.lastReadAt })
        .from(matchReads)
        .where(and(eq(matchReads.matchId, m.id), eq(matchReads.userId, viewerId)));
      const [{ n }] = (await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.matchId, m.id),
            sql`${messages.senderId} <> ${viewerId}`,
            read ? sql`${messages.createdAt} > ${read.at}` : sql`true`,
          ),
        )) as [{ n: number }];
      out.push({
        matchId: m.id,
        profile: m.profile,
        lastMessage: last ? toView(last, viewerId, this.now()) : null,
        unread: n,
        createdAt: m.createdAt,
        mode: m.mode,
        muted: prefs.get(m.id)?.muted ?? false,
        archived: prefs.get(m.id)?.archived ?? false,
        pinned: Boolean(prefs.get(m.id)?.pinnedAt),
      });
    }
    // Pinned chats first, most recently pinned first (phase 38); then by latest activity.
    const pinnedAt = (c: Conversation) => prefs.get(c.matchId)?.pinnedAt?.getTime() ?? 0;
    const activity = (c: Conversation) => c.lastMessage?.createdAt ?? c.createdAt;
    return out.sort((a, b) => pinnedAt(b) - pinnedAt(a) || activity(b).localeCompare(activity(a)));
  }

  async suggestIcebreakers(matchId: string, viewerId: string, locale: Locale): Promise<string[]> {
    const { otherId } = await this.participant(matchId, viewerId);
    const [profile] = await this.db
      .select({ name: profiles.displayName, bio: profiles.bio })
      .from(profiles)
      .where(eq(profiles.userId, otherId));
    const answers = await this.db
      .select({ promptKey: prompts.promptKey, answer: prompts.answer })
      .from(prompts)
      .where(eq(prompts.userId, otherId))
      .orderBy(asc(prompts.position));
    const provider =
      typeof this.icebreakers === 'function'
        ? await this.icebreakers(viewerId, otherId)
        : this.icebreakers;
    return provider.suggest({
      locale,
      otherName: profile?.name ?? '',
      bio: profile?.bio ?? null,
      prompts: answers as { promptKey: PromptKey; answer: string }[],
    });
  }
}
