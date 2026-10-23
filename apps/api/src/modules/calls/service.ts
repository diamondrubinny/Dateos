// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { randomBytes } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  CALL_REFUSALS_BEFORE_COOLDOWN,
  CALL_RING_SECONDS,
  CALL_TOKEN_SECONDS,
  CALLS_PER_CHAT_PER_HOUR,
  CALLS_PER_MEMBER_PER_HOUR,
  type CallJoin,
  type CallStatus,
  type CallView,
  ErrorCode,
  type StartCallInput,
} from '@nexaheart/shared';
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm';
import type { CallMedia, CallRole } from '../../lib/livekit.js';
import type { Realtime } from '../../lib/realtime.js';
import { HttpError } from '../../plugins/error-handler.js';
import { callView, type ChatService } from '../chat/service.js';

const { calls, messages, preferences } = schema;

type CallRow = typeof calls.$inferSelect;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const unavailable = () =>
  new HttpError(503, ErrorCode.ServiceUnavailable, 'Calls are not available in this community.');
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { cause?: { code?: string } }).cause?.code === '23505');

export interface CallSettings {
  enabled: boolean;
  maxMinutes: number;
}

const OPEN: CallStatus[] = ['ringing', 'active'];

/**
 * Video and voice dates (phase 15). The API decides who may call whom and hands out short,
 * single-room join tokens; LiveKit carries the audio and video, which are never stored. Every
 * action re-checks that the viewer is a participant of the active, unblocked match.
 */
export class CallService {
  constructor(
    private readonly db: Database,
    private readonly chat: ChatService,
    private readonly realtime: Pick<Realtime, 'publish'>,
    /** The video server now (it can be changed in the dashboard, phase 24). */
    private readonly mediaSource: () => Promise<CallMedia | null>,
    private readonly settings: () => Promise<CallSettings>,
    /** Content-free push to the person being called. */
    private readonly ring: (userId: string, matchId: string) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Configured (LiveKit) and turned on by the community's admins. */
  async enabled(): Promise<CallSettings | null> {
    if (!(await this.mediaSource())) return null;
    const settings = await this.settings();
    return settings.enabled ? settings : null;
  }

  private async acceptsCalls(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ accept: preferences.acceptCalls })
      .from(preferences)
      .where(eq(preferences.userId, userId));
    return row?.accept ?? true;
  }

  /** Whether the chat shows the call button (the start rules below still apply). */
  async available(matchId: string, viewerId: string, otherId: string): Promise<boolean> {
    if (!(await this.enabled())) return false;
    return (
      (await this.chat.mediaUnlocked(matchId, viewerId, otherId)) &&
      (await this.acceptsCalls(otherId))
    );
  }

  async start(matchId: string, callerId: string, input: StartCallInput): Promise<CallView> {
    const settings = await this.enabled();
    const media = await this.mediaSource();
    if (!settings || !media) throw unavailable();
    const { otherId } = await this.chat.participant(matchId, callerId);
    if (!(await this.chat.mediaUnlocked(matchId, callerId, otherId))) {
      throw new HttpError(
        403,
        ErrorCode.Forbidden,
        'Calls unlock after you both sent a few messages.',
      );
    }
    if (!(await this.acceptsCalls(otherId))) {
      throw new HttpError(403, ErrorCode.Forbidden, 'This person does not accept calls.');
    }
    await this.checkLimits(matchId, callerId, otherId);

    const room = randomBytes(16).toString('hex');
    await media.createRoom(room);
    let call: CallRow;
    let messageId: string;
    try {
      ({ call, messageId } = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(calls)
          .values({
            matchId,
            callerId,
            calleeId: otherId,
            video: input.video,
            room,
            maxMinutes: settings.maxMinutes,
            createdAt: new Date(this.now()),
          })
          .returning();
        const [message] = await tx
          .insert(messages)
          .values({
            matchId,
            senderId: callerId,
            clientId: `call-${created!.id}`,
            kind: 'call',
            callId: created!.id,
          })
          .returning({ id: messages.id });
        return { call: created!, messageId: message!.id };
      }));
    } catch (error) {
      await media.deleteRoom(room).catch(() => undefined);
      if (isUniqueViolation(error)) {
        throw new HttpError(409, ErrorCode.Conflict, 'There is already a call in this chat.');
      }
      throw error;
    }
    await this.chat.deliverMessage(messageId, callerId, otherId, { push: false });
    await this.realtime.publish(otherId, {
      type: 'call.incoming',
      matchId,
      callId: call.id,
      video: call.video,
    });
    this.ring(otherId, matchId).catch(() => undefined);
    return callView(call, callerId);
  }

  /** Per chat, per member, a cooldown after refusals, and one open call per caller at a time. */
  private async checkLimits(matchId: string, callerId: string, otherId: string) {
    const hourAgo = new Date(this.now() - 3_600_000);
    const tooMany = () =>
      new HttpError(429, ErrorCode.RateLimited, 'Too many calls. Please try again later.');
    const inChat = await this.db.$count(
      calls,
      and(eq(calls.matchId, matchId), eq(calls.callerId, callerId), gt(calls.createdAt, hourAgo)),
    );
    if (inChat >= CALLS_PER_CHAT_PER_HOUR) throw tooMany();
    const overall = await this.db.$count(
      calls,
      and(eq(calls.callerId, callerId), gt(calls.createdAt, hourAgo)),
    );
    if (overall >= CALLS_PER_MEMBER_PER_HOUR) throw tooMany();

    // The call lines and the replies are both stamped by the database, so they compare safely.
    const recent = await this.db
      .select({ status: calls.status, lineAt: messages.createdAt })
      .from(calls)
      .innerJoin(messages, eq(messages.callId, calls.id))
      .where(and(eq(calls.matchId, matchId), eq(calls.callerId, callerId)))
      .orderBy(desc(calls.createdAt))
      .limit(CALL_REFUSALS_BEFORE_COOLDOWN);
    const refused =
      recent.length === CALL_REFUSALS_BEFORE_COOLDOWN &&
      recent.every((c) => c.status === 'declined' || c.status === 'missed');
    if (refused) {
      const repliedSince = await this.db.$count(
        messages,
        and(
          eq(messages.matchId, matchId),
          eq(messages.senderId, otherId),
          eq(messages.kind, 'text'),
          gt(messages.createdAt, recent[0]!.lineAt),
        ),
      );
      if (repliedSince === 0) {
        throw new HttpError(
          429,
          ErrorCode.RateLimited,
          'They did not pick up. Wait until they write to you before calling again.',
        );
      }
    }

    const busy = await this.db.$count(
      calls,
      and(
        inArray(calls.status, OPEN),
        or(eq(calls.callerId, callerId), eq(calls.calleeId, callerId)),
      ),
    );
    if (busy > 0) throw new HttpError(409, ErrorCode.Conflict, 'You are already in a call.');
  }

  /** The call, for one of its two participants of a still active, unblocked match. */
  private async load(callId: string, userId: string): Promise<CallRow> {
    const [call] = await this.db
      .select()
      .from(calls)
      .where(and(eq(calls.id, callId), or(eq(calls.callerId, userId), eq(calls.calleeId, userId))));
    if (!call) throw notFound();
    await this.chat.participant(call.matchId, userId);
    return call;
  }

  private expired(call: CallRow): boolean {
    return (
      call.status === 'ringing' && call.createdAt.getTime() + CALL_RING_SECONDS * 1000 < this.now()
    );
  }

  async get(callId: string, userId: string): Promise<CallView> {
    return callView(await this.load(callId, userId), userId);
  }

  async join(callId: string, userId: string, publicKey: string): Promise<CallJoin> {
    const media = await this.mediaSource();
    if (!media) throw unavailable();
    let call = await this.load(callId, userId);
    if (!OPEN.includes(call.status) || this.expired(call)) {
      throw new HttpError(409, ErrorCode.Conflict, 'This call has ended.');
    }
    const role: CallRole = call.callerId === userId ? 'caller' : 'callee';
    if (role === 'callee' && call.status === 'ringing') {
      call = (await this.move(call, 'active', ['ringing'])) ?? call;
      if (call.status !== 'active') {
        throw new HttpError(409, ErrorCode.Conflict, 'This call has ended.');
      }
    }
    const token = await media.joinToken({
      room: call.room,
      role,
      video: call.video,
      ttlSeconds: CALL_TOKEN_SECONDS,
      publicKey,
    });
    return { url: media.url, token, room: call.room, call: callView(call, userId) };
  }

  /** Only the person being called can decline. */
  async decline(callId: string, userId: string): Promise<CallView> {
    const call = await this.load(callId, userId);
    if (call.callerId === userId) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Hang up instead.');
    }
    const moved = await this.move(call, 'declined', ['ringing']);
    if (!moved) throw new HttpError(409, ErrorCode.Conflict, 'This call has ended.');
    return callView(moved, userId);
  }

  /** Hang up: a call nobody answered yet becomes "missed", an answered one "ended". */
  async end(callId: string, userId: string): Promise<CallView> {
    const call = await this.load(callId, userId);
    const moved =
      call.status === 'ringing'
        ? await this.move(call, call.callerId === userId ? 'missed' : 'declined', ['ringing'])
        : await this.move(call, 'ended', ['active']);
    const current = moved ?? (await this.load(callId, userId));
    return callView(current, userId);
  }

  /** The match ended (unmatch, block, suspension): hang up at once, without any checks. */
  async endForMatch(matchId: string): Promise<void> {
    const open = await this.db
      .select()
      .from(calls)
      .where(and(eq(calls.matchId, matchId), inArray(calls.status, OPEN)));
    for (const call of open) {
      await this.move(call, call.status === 'ringing' ? 'missed' : 'ended', [call.status]);
    }
  }

  /** Hangs up every open call between two people (used when one reports the other). */
  async endBetween(a: string, b: string): Promise<void> {
    const open = await this.db
      .select()
      .from(calls)
      .where(
        and(
          inArray(calls.status, OPEN),
          or(
            and(eq(calls.callerId, a), eq(calls.calleeId, b)),
            and(eq(calls.callerId, b), eq(calls.calleeId, a)),
          ),
        ),
      );
    for (const call of open) {
      await this.move(call, call.status === 'ringing' ? 'missed' : 'ended', [call.status]);
    }
  }

  /** Signed events from LiveKit keep the state right when an app crashes or loses the network. */
  async webhook(body: string, authorization: string | undefined): Promise<boolean> {
    const media = await this.mediaSource();
    if (!media) return false;
    const event = await media.receiveWebhook(body, authorization);
    if (!event) return false;
    const [call] = await this.db
      .select()
      .from(calls)
      .where(and(eq(calls.room, event.room), inArray(calls.status, OPEN)));
    if (!call) return true;
    if (event.event === 'participant_joined' && event.role === 'callee') {
      await this.move(call, 'active', ['ringing']);
    } else if (event.event === 'participant_left' && event.role) {
      // A 1:1 call is over when either person leaves (LiveKit already waited for a reconnect).
      if (call.status === 'active') await this.move(call, 'ended', ['active']);
      else if (event.role === 'caller') await this.move(call, 'missed', ['ringing']);
    } else if (event.event === 'room_finished') {
      await this.move(call, call.status === 'ringing' ? 'missed' : 'ended', [call.status]);
    }
    return true;
  }

  /**
   * Moves a call on only from the expected statuses (a concurrent change wins once), closes the
   * room when the call is over and updates the chat line for both people.
   */
  private async move(
    call: CallRow,
    status: CallStatus,
    from: CallStatus[],
  ): Promise<CallRow | null> {
    const at = new Date(this.now());
    const [updated] = await this.db
      .update(calls)
      .set(status === 'active' ? { status, answeredAt: at } : { status, endedAt: at })
      .where(and(eq(calls.id, call.id), inArray(calls.status, from)))
      .returning();
    if (!updated) return null;
    if (status !== 'active') {
      await (await this.mediaSource())?.deleteRoom(call.room).catch(() => undefined);
    }
    const [message] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.callId, call.id));
    const people = [call.callerId, call.calleeId];
    await Promise.all(
      people.map((userId) =>
        this.realtime.publish(userId, {
          type: 'call.updated',
          matchId: call.matchId,
          callId: call.id,
          status,
        }),
      ),
    );
    if (message) await this.chat.announceUpdated(call.matchId, message.id, people);
    return updated;
  }
}
