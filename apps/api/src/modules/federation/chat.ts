// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { randomUUID } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  federatedDeliveryResponseSchema,
  federatedWireMessageSchema,
  harmCategories,
  scamSignals,
  type FederatedMessage,
  type FederatedMessagesPage,
  type RealtimeEvent,
} from '@nexaheart/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import { messageFlags } from '../chat/service.js';
import type { FederatedMembers } from './members.js';
import type { FederationService, IncomingSigned } from './service.js';

const { federationMatches, federationMessages } = schema;
type MessageRow = typeof federationMessages.$inferSelect;

const PAGE = 50;
const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

export interface FederatedChatDeps {
  /** Live update to a member here. */
  publish: (userId: string, event: RealtimeEvent) => void;
  /** Content-free push to a member here who received a message. */
  pushMessage: (userId: string, matchId: string) => Promise<void>;
}

/** What the member here sees: a hurtful message from the other side arrives hidden. */
function toView(row: MessageRow): FederatedMessage {
  const harm = harmCategories.filter((c) => row.flags.includes(`harm:${c}`));
  const scam = scamSignals.filter((s) => row.flags.includes(`scam:${s}`));
  return {
    id: row.messageId,
    mine: row.mine,
    body: row.body,
    hidden: !row.mine && harm.length > 0,
    harm: row.mine ? [] : harm,
    scam: row.mine ? [] : scam,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Text chat across communities (phase 28c). Each server keeps its own member's side of the
 * conversation and runs its own filters; a message is stored here only once the partner took it.
 */
export class FederatedChat {
  constructor(
    private readonly db: Database,
    private readonly federation: FederationService,
    private readonly members: FederatedMembers,
    private readonly deps: FederatedChatDeps,
  ) {}

  /** The member's match, with its partner still connected. */
  private async match(userId: string, matchId: string) {
    const [row] = await this.db
      .select()
      .from(federationMatches)
      .where(and(eq(federationMatches.id, matchId), eq(federationMatches.userId, userId)));
    if (!row) throw notFound();
    const partner = await this.federation.activePartner(row.partnerId);
    if (!partner) throw notFound();
    return { row, partner };
  }

  private async count(matchId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(federationMessages)
      .where(eq(federationMessages.matchId, matchId));
    return r?.n ?? 0;
  }

  /** Newest first, 50 at a time; opening the chat marks it read (here only). */
  async messages(userId: string, matchId: string, before?: string): Promise<FederatedMessagesPage> {
    const { row } = await this.match(userId, matchId);
    let cursor: MessageRow | undefined;
    if (before) {
      [cursor] = await this.db
        .select()
        .from(federationMessages)
        .where(
          and(eq(federationMessages.matchId, matchId), eq(federationMessages.messageId, before)),
        );
      if (!cursor) throw notFound();
    }
    const rows = await this.db
      .select()
      .from(federationMessages)
      .where(
        and(
          eq(federationMessages.matchId, matchId),
          cursor
            ? or(
                lt(federationMessages.createdAt, cursor.createdAt),
                and(
                  eq(federationMessages.createdAt, cursor.createdAt),
                  lt(federationMessages.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(federationMessages.createdAt), desc(federationMessages.id))
      .limit(PAGE + 1);
    if (!before) {
      await this.db
        .update(federationMatches)
        .set({ readAt: new Date() })
        .where(eq(federationMatches.id, row.id));
    }
    const page = rows.slice(0, PAGE);
    return {
      messages: page.map(toView),
      before: rows.length > PAGE ? page[page.length - 1]!.messageId : null,
    };
  }

  /**
   * Sends a text to the match's community. Idempotent by `clientId`: a retry never sends twice.
   * If the other side says the match is gone, it ends here too.
   */
  async send(
    userId: string,
    matchId: string,
    text: string,
    clientId: string,
  ): Promise<FederatedMessage> {
    const { row, partner } = await this.match(userId, matchId);
    await this.members.requireTakingPart(userId);
    const [existing] = await this.db
      .select()
      .from(federationMessages)
      .where(
        and(eq(federationMessages.matchId, matchId), eq(federationMessages.clientId, clientId)),
      );
    if (existing) return toView(existing);

    const messageId = randomUUID();
    const answer = await this.federation.send(partner.url, 'POST', '/v1/federation/messages', {
      from: await this.members.aliasOf(partner.id, userId),
      to: row.alias,
      id: messageId,
      body: text,
    });
    const parsed = federatedDeliveryResponseSchema.safeParse(answer);
    if (!parsed.success) {
      throw new HttpError(502, ErrorCode.BadGateway, 'That community gave an unexpected answer.');
    }
    if (!parsed.data.delivered) {
      // Their side no longer has the match (an unmatch we missed): end it here too.
      await this.db.delete(federationMatches).where(eq(federationMatches.id, row.id));
      this.deps.publish(userId, { type: 'federated.matches' });
      throw new HttpError(410, ErrorCode.NotFound, 'This match has ended.');
    }
    const [stored] = await this.db
      .insert(federationMessages)
      .values({
        matchId,
        messageId,
        mine: true,
        clientId,
        body: text,
        flags: messageFlags(text, await this.count(matchId)),
      })
      .onConflictDoNothing()
      .returning();
    if (!stored) {
      // The same clientId raced in twice: return the one that won.
      const [won] = await this.db
        .select()
        .from(federationMessages)
        .where(
          and(eq(federationMessages.matchId, matchId), eq(federationMessages.clientId, clientId)),
        );
      return toView(won!);
    }
    return toView(stored);
  }

  /** A partner's member wrote to one of ours. Stored only if the match exists here. */
  async receive(incoming: IncomingSigned): Promise<{ delivered: boolean }> {
    const partner = await this.federation.verifyActive(incoming);
    let body: unknown = null;
    try {
      body = JSON.parse(incoming.body);
    } catch {
      // handled below
    }
    const parsed = federatedWireMessageSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, ErrorCode.BadRequest, 'Malformed request.');
    const message = parsed.data;
    const userId = await this.members.memberOf(partner.id, message.to);
    if (!userId) return { delivered: false };
    const [match] = await this.db
      .select({ id: federationMatches.id })
      .from(federationMatches)
      .where(
        and(
          eq(federationMatches.partnerId, partner.id),
          eq(federationMatches.userId, userId),
          eq(federationMatches.alias, message.from),
        ),
      );
    if (!match) return { delivered: false };
    // This server's own filters, as for a message from someone here.
    const inserted = await this.db
      .insert(federationMessages)
      .values({
        matchId: match.id,
        messageId: message.id,
        mine: false,
        body: message.body,
        flags: messageFlags(message.body, await this.count(match.id)),
      })
      .onConflictDoNothing()
      .returning({ id: federationMessages.id });
    if (inserted.length > 0) {
      this.deps.publish(userId, { type: 'federated.message', matchId: match.id });
      await this.deps.pushMessage(userId, match.id).catch(() => undefined);
    }
    return { delivered: true };
  }
}
