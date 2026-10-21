import { checkHarm, detectScamSignals, type IcebreakerProvider } from '@dateos/ai';
import { schema, type Database } from '@dateos/db';
import {
  ErrorCode,
  harmCategories,
  MESSAGES_BEFORE_IMAGES,
  scamSignals,
  type Conversation,
  type MessagesPage,
  type MessageView,
  type PromptKey,
} from '@dateos/shared';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Realtime } from '../../lib/realtime.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { DiscoveryService } from '../discovery/service.js';
import { photoUrl } from '../me/service.js';
import type { PhotoService } from '../photos/service.js';
import type { AudioService } from './audio.js';

const { messages, matches, matchReads, photos, profiles, prompts, audioClips, preferences } =
  schema;

type MessageRow = typeof messages.$inferSelect & {
  photoStatus: string | null;
  audioStatus: string | null;
  audioDurationMs: number | null;
};

/** A receiver sees media only after it passed scanning; senders see their own uploads. */
const visibleTo = (viewerId: string) =>
  sql`(${messages.kind} = 'text' OR ${messages.senderId} = ${viewerId} OR ${photos.status} = 'clean' OR ${audioClips.status} = 'clean')`;

const mediaStatus = (status: string | null) =>
  status === 'clean'
    ? ('clean' as const)
    : status === 'rejected'
      ? ('rejected' as const)
      : ('pending' as const);

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

/** What a given participant sees. Harmful messages arrive hidden for the receiver only. */
export function toView(row: MessageRow, viewerId: string): MessageView {
  const mine = row.senderId === viewerId;
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
    hidden: !mine && harm.length > 0,
    harm,
    scam: mine ? [] : scam,
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
        createdAt: messages.createdAt,
        photoStatus: photos.status,
        audioStatus: audioClips.status,
        audioDurationMs: audioClips.durationMs,
      })
      .from(messages)
      .leftJoin(photos, eq(photos.id, messages.photoId))
      .leftJoin(audioClips, eq(audioClips.id, messages.audioId))
      .where(where);
  }

  private async counts(matchId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ senderId: messages.senderId, n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.matchId, matchId), eq(messages.kind, 'text')))
      .groupBy(messages.senderId);
    return new Map(rows.map((r) => [r.senderId, r.n]));
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
    return {
      messages: page.reverse().map((r) => toView(r, viewerId)),
      before: rows.length > limit ? page[0]!.createdAt.toISOString() : null,
      otherReadAt: read?.at.toISOString() ?? null,
      imagesUnlocked: await this.imagesUnlocked(matchId, viewerId, otherId),
      otherAcceptsVoice: await this.acceptsVoice(otherId),
    };
  }

  private async acceptsVoice(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ accept: preferences.acceptVoice })
      .from(preferences)
      .where(eq(preferences.userId, userId));
    return row?.accept ?? true;
  }

  /** Voice messages: same unlock rule as images, and only if the receiver accepts them. */
  async sendVoice(matchId: string, senderId: string, buffer: Buffer): Promise<MessageView> {
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
    const clip = await this.audio.upload(senderId, buffer);
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
      message: toView(row!, senderId),
    });
    return toView(row!, senderId);
  }

  async openAudio(viewerId: string, audioId: string, format: 'aac' | 'opus' = 'aac') {
    if (!this.audio) throw notFound();
    return this.audio.open(viewerId, audioId, format);
  }

  /** Idempotent: re-sending the same clientId returns the original message. */
  async send(
    matchId: string,
    senderId: string,
    text: string,
    clientId: string,
  ): Promise<MessageView> {
    const { otherId } = await this.participant(matchId, senderId);
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
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    const [row] = await this.rows(
      and(eq(messages.senderId, senderId), eq(messages.clientId, clientId)),
    );
    if (!row || row.matchId !== matchId)
      throw new HttpError(409, ErrorCode.Conflict, 'Message id already used.');
    if (inserted.length > 0) await this.deliver(row, senderId, otherId);
    return toView(row, senderId);
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
      message: toView(row!, senderId),
    });
    return toView(row!, senderId);
  }

  private async deliver(row: MessageRow, senderId: string, otherId: string) {
    this.notifier?.messageReceived(otherId, row.matchId).catch(() => undefined);
    await Promise.all([
      this.realtime.publish(senderId, {
        type: 'message.new',
        matchId: row.matchId,
        message: toView(row, senderId),
      }),
      this.realtime.publish(otherId, {
        type: 'message.new',
        matchId: row.matchId,
        message: toView(row, otherId),
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
    await this.realtime.publish(otherId, { type: 'message.read', matchId, at: at.toISOString() });
  }

  async typing(matchId: string, viewerId: string): Promise<void> {
    const { otherId } = await this.participant(matchId, viewerId);
    await this.realtime.publish(otherId, { type: 'typing', matchId });
  }

  /** Matches with their latest message and unread count, newest activity first. */
  async inbox(viewerId: string): Promise<Conversation[]> {
    const summaries = await this.discovery.matches(viewerId);
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
        lastMessage: last ? toView(last, viewerId) : null,
        unread: n,
        createdAt: m.createdAt,
      });
    }
    const activity = (c: Conversation) => c.lastMessage?.createdAt ?? c.createdAt;
    return out.sort((a, b) => activity(b).localeCompare(activity(a)));
  }

  async suggestIcebreakers(
    matchId: string,
    viewerId: string,
    locale: 'he' | 'en',
  ): Promise<string[]> {
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
