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

const { messages, matches, matchReads, photos, profiles, prompts } = schema;

type MessageRow = typeof messages.$inferSelect & { photoStatus: string | null };

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
  const status =
    row.photoStatus === 'clean' ? 'clean' : row.photoStatus === 'rejected' ? 'rejected' : 'pending';
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
    private readonly icebreakers: IcebreakerProvider,
  ) {}

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
        flags: messages.flags,
        createdAt: messages.createdAt,
        photoStatus: photos.status,
      })
      .from(messages)
      .leftJoin(photos, eq(photos.id, messages.photoId))
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
    // The receiver never sees an image before it passed scanning.
    conditions.push(
      sql`(${messages.kind} = 'text' OR ${messages.senderId} = ${viewerId} OR ${photos.status} = 'clean')`,
    );
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
    };
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
      const [last] = await this.rows(
        and(
          eq(messages.matchId, m.id),
          sql`(${messages.kind} = 'text' OR ${messages.senderId} = ${viewerId} OR ${photos.status} = 'clean')`,
        ),
      )
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
    return this.icebreakers.suggest({
      locale,
      otherName: profile?.name ?? '',
      bio: profile?.bio ?? null,
      prompts: answers as { promptKey: PromptKey; answer: string }[],
    });
  }
}
