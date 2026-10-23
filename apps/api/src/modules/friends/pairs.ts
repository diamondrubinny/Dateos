// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm, detectScamSignals } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  ageOn,
  ErrorCode,
  PAIR_LINK_DAYS,
  type DoubleChat,
  type DoubleMessage,
  type MyPair,
  type PairCard,
  type PairMember,
  type RealtimeEvent,
} from '@nexaheart/shared';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import type { DiscoveryService } from '../discovery/service.js';
import { notSeparated } from '../discovery/visibility.js';
import { photoUrl } from '../me/service.js';
import { createLink, useLink } from './links.js';

const { pairs, pairInteractions, doubleMatches, doubleMessages, profiles, photos } = schema;
const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const PAGE = 50;

type Publish = (userId: string, event: RealtimeEvent) => Promise<void>;
type PairRow = typeof pairs.$inferSelect;

/**
 * Double dates (phase 22): two friends form a pair; a pair sees another pair only when each of
 * the two may see each of the other two under the usual rules; when both pairs like each other, a
 * group chat of four opens. Anyone leaving, or a block between any two of them, closes it for all.
 */
export class PairService {
  constructor(
    private readonly db: Database,
    private readonly discovery: DiscoveryService,
    private readonly publish: Publish,
    private readonly today: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  // -------------------------------------------------------------- the pair

  private async activePair(userId: string): Promise<PairRow | undefined> {
    const [row] = await this.db
      .select()
      .from(pairs)
      .where(and(or(eq(pairs.userA, userId), eq(pairs.userB, userId)), isNull(pairs.endedAt)));
    return row;
  }

  private async requirePair(userId: string): Promise<PairRow & { friendId: string }> {
    const pair = await this.activePair(userId);
    if (!pair) throw new HttpError(409, ErrorCode.Conflict, 'Pair up with a friend first.');
    return { ...pair, friendId: pair.userA === userId ? pair.userB : pair.userA };
  }

  async invite(userId: string): Promise<{ token: string; expiresAt: string }> {
    if (await this.activePair(userId)) {
      throw new HttpError(409, ErrorCode.Conflict, 'You’re already in a pair.');
    }
    return createLink(this.db, userId, 'pair', PAIR_LINK_DAYS, this.now());
  }

  /** The friend accepts the invitation while signed in. */
  async join(userId: string, token: string): Promise<MyPair> {
    const pairId = await this.db.transaction(async (tx) => {
      const ownerId = await useLink(tx, token, 'pair', this.now());
      if (!ownerId || ownerId === userId) {
        throw new HttpError(404, ErrorCode.NotFound, 'This link doesn’t work any more.');
      }
      const { rows } = await tx.execute(sql`
        SELECT 1 FROM "user" a, "user" b
        WHERE a.id = ${ownerId} AND b.id = ${userId} AND a.status = 'active' AND b.status = 'active'
          AND ${notSeparated(sql`${ownerId}`, sql`${userId}`)}`);
      if (rows.length === 0) {
        throw new HttpError(404, ErrorCode.NotFound, 'This link doesn’t work any more.');
      }
      // The partial unique indexes keep one active pair per person, even under races.
      const [pair] = await tx
        .insert(pairs)
        .values({ userA: ownerId, userB: userId })
        .onConflictDoNothing()
        .returning({ id: pairs.id });
      if (!pair) throw new HttpError(409, ErrorCode.Conflict, 'One of you is already in a pair.');
      return pair.id;
    });
    const pair = (await this.myPair(userId))!;
    if (pair.id !== pairId) throw notFound();
    return pair;
  }

  async myPair(userId: string): Promise<MyPair | null> {
    const pair = await this.activePair(userId);
    if (!pair) return null;
    const friendId = pair.userA === userId ? pair.userB : pair.userA;
    const [friend] = await this.members([friendId]);
    return friend ? { id: pair.id, friend, createdAt: pair.createdAt.toISOString() } : null;
  }

  /** Either friend can end the pair; its double chats close for everyone. */
  async leavePair(userId: string): Promise<void> {
    const pair = await this.activePair(userId);
    if (!pair) return;
    await this.db
      .update(pairs)
      .set({ endedAt: new Date(this.now()) })
      .where(eq(pairs.id, pair.id));
    const open = await this.db
      .select({ id: doubleMatches.id })
      .from(doubleMatches)
      .where(
        and(
          isNull(doubleMatches.closedAt),
          or(eq(doubleMatches.pairA, pair.id), eq(doubleMatches.pairB, pair.id)),
        ),
      );
    for (const d of open) await this.close(d.id, userId);
  }

  private async members(ids: string[]): Promise<PairMember[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        id: profiles.userId,
        displayName: profiles.displayName,
        birthDate: profiles.birthDate,
      })
      .from(profiles)
      .where(inArray(profiles.userId, ids));
    const firstPhotos = await this.db
      .select({ id: photos.id, userId: photos.userId, position: photos.position })
      .from(photos)
      .where(
        and(inArray(photos.userId, ids), eq(photos.status, 'clean'), eq(photos.purpose, 'profile')),
      )
      .orderBy(asc(photos.position));
    const photoBy = new Map<string, string>();
    for (const p of firstPhotos) if (!photoBy.has(p.userId)) photoBy.set(p.userId, p.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => {
      const r = byId.get(id);
      if (!r) return [];
      const photo = photoBy.get(id);
      return [
        {
          id,
          displayName: r.displayName,
          age: ageOn(r.birthDate, this.today()),
          photoUrl: photo ? photoUrl(photo) : null,
        },
      ];
    });
  }

  // -------------------------------------------------------------- pairs seeing pairs

  /**
   * Other pairs both of us may see: each member of theirs is a dating candidate of each of us
   * (the candidate query holds both ways, with every rule), minus pairs we decided on.
   */
  async discover(userId: string, limit = 20): Promise<PairCard[]> {
    const mine = await this.requirePair(userId);
    const [seenByMe, seenByFriend] = await Promise.all([
      this.discovery.candidateIds(userId),
      this.discovery.candidateIds(mine.friendId),
    ]);
    const both = [...seenByMe].filter((id) => seenByFriend.has(id));
    if (both.length < 2) return [];
    const { rows } = await this.db.execute<{ id: string; user_a: string; user_b: string }>(sql`
      SELECT p.id, p.user_a, p.user_b FROM pairs p
      WHERE p.ended_at IS NULL AND p.id <> ${mine.id}
        AND p.user_a = ANY(${sql.param(both)}::text[]) AND p.user_b = ANY(${sql.param(both)}::text[])
        AND NOT EXISTS (SELECT 1 FROM pair_interactions pi WHERE pi.pair_id = ${mine.id} AND pi.target_pair_id = p.id)
      ORDER BY p.created_at DESC
      LIMIT ${limit}`);
    const people = new Map(
      (await this.members(rows.flatMap((r) => [r.user_a, r.user_b]))).map((m) => [m.id, m]),
    );
    return rows.flatMap((r) => {
      const a = people.get(r.user_a);
      const b = people.get(r.user_b);
      return a && b ? [{ id: r.id, members: [a, b] }] : [];
    });
  }

  /** Checked again on every decision: all four must still be mutually visible. */
  private async allVisible(mine: PairRow & { friendId: string }, target: PairRow) {
    const us = [mine.userA, mine.userB];
    const them = [target.userA, target.userB];
    for (const a of us) {
      for (const b of them) if (!(await this.discovery.isCandidate(a, b))) return false;
    }
    return true;
  }

  async decide(
    userId: string,
    targetPairId: string,
    kind: 'like' | 'pass',
  ): Promise<{ doubleId: string | null }> {
    const mine = await this.requirePair(userId);
    const [target] = await this.db
      .select()
      .from(pairs)
      .where(and(eq(pairs.id, targetPairId), isNull(pairs.endedAt)));
    if (!target || target.id === mine.id || !(await this.allVisible(mine, target))) {
      throw notFound();
    }
    const result = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(pairInteractions)
        .values({ pairId: mine.id, targetPairId, actorId: userId, kind })
        .onConflictDoNothing()
        .returning({ id: pairInteractions.id });
      if (inserted.length === 0) {
        throw new HttpError(409, ErrorCode.Conflict, 'Your pair already decided on them.');
      }
      if (kind === 'pass') return null;
      const [reverse] = await tx
        .select({ id: pairInteractions.id })
        .from(pairInteractions)
        .where(
          and(
            eq(pairInteractions.pairId, targetPairId),
            eq(pairInteractions.targetPairId, mine.id),
            eq(pairInteractions.kind, 'like'),
          ),
        );
      if (!reverse) return null;
      const [pairA, pairB] = [mine.id, targetPairId].sort() as [string, string];
      const members = [mine.userA, mine.userB, target.userA, target.userB];
      await tx.insert(doubleMatches).values({ pairA, pairB, members }).onConflictDoNothing();
      const [double] = await tx
        .select({ id: doubleMatches.id })
        .from(doubleMatches)
        .where(and(eq(doubleMatches.pairA, pairA), eq(doubleMatches.pairB, pairB)));
      return { id: double!.id, members };
    });
    if (!result) return { doubleId: null };
    for (const m of result.members) {
      await this.publish(m, { type: 'double.new', doubleId: result.id }).catch(() => undefined);
    }
    return { doubleId: result.id };
  }

  // -------------------------------------------------------------- the group chat

  private async requireMember(doubleId: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(doubleMatches)
      .where(and(eq(doubleMatches.id, doubleId), sql`${userId} = ANY(${doubleMatches.members})`));
    if (!row) throw notFound();
    return row;
  }

  private toMessage(row: typeof doubleMessages.$inferSelect, viewerId: string): DoubleMessage {
    const mine = row.senderId === viewerId;
    return {
      id: row.id,
      senderId: row.senderId,
      mine,
      text: row.body,
      hidden: !mine && row.flags.some((f) => f.startsWith('harm:')),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async doubles(userId: string): Promise<DoubleChat[]> {
    const rows = await this.db
      .select()
      .from(doubleMatches)
      .where(sql`${userId} = ANY(${doubleMatches.members})`)
      .orderBy(desc(doubleMatches.createdAt))
      .limit(50);
    const out: DoubleChat[] = [];
    for (const d of rows) {
      const [last] = await this.db
        .select()
        .from(doubleMessages)
        .where(eq(doubleMessages.doubleId, d.id))
        .orderBy(desc(doubleMessages.createdAt))
        .limit(1);
      out.push({
        id: d.id,
        members: await this.members(d.members.filter((m) => m !== userId)),
        closed: d.closedAt !== null,
        lastMessage: last ? this.toMessage(last, userId) : null,
        createdAt: d.createdAt.toISOString(),
      });
    }
    return out;
  }

  async messages(doubleId: string, userId: string, before?: string): Promise<DoubleMessage[]> {
    await this.requireMember(doubleId, userId);
    const rows = await this.db
      .select()
      .from(doubleMessages)
      .where(
        and(
          eq(doubleMessages.doubleId, doubleId),
          before ? lt(doubleMessages.createdAt, new Date(before)) : sql`true`,
        ),
      )
      .orderBy(desc(doubleMessages.createdAt))
      .limit(PAGE);
    return rows.reverse().map((r) => this.toMessage(r, userId));
  }

  /** Text only, through the same harm and scam checks as 1:1 chats; retries are idempotent. */
  async send(
    doubleId: string,
    userId: string,
    text: string,
    clientId: string,
  ): Promise<DoubleMessage> {
    const double = await this.requireMember(doubleId, userId);
    if (double.closedAt) throw new HttpError(409, ErrorCode.Conflict, 'This chat has closed.');
    const harm = checkHarm(text);
    const flags = [
      ...harm.categories.map((c) => `harm:${c}`),
      ...detectScamSignals(text, 0).map((s) => `scam:${s}`),
    ];
    await this.db
      .insert(doubleMessages)
      .values({ doubleId, senderId: userId, clientId, body: text, flags })
      .onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(doubleMessages)
      .where(and(eq(doubleMessages.senderId, userId), eq(doubleMessages.clientId, clientId)));
    for (const m of double.members) {
      if (m !== userId) {
        await this.publish(m, { type: 'double.message', doubleId }).catch(() => undefined);
      }
    }
    return this.toMessage(row!, userId);
  }

  /** Anyone leaving closes the chat for all four: three people isn't a double date. */
  async leave(doubleId: string, userId: string): Promise<void> {
    await this.requireMember(doubleId, userId);
    await this.close(doubleId, userId);
  }

  private async close(doubleId: string, by: string): Promise<void> {
    const [row] = await this.db
      .update(doubleMatches)
      .set({ closedAt: new Date(this.now()), closedBy: by })
      .where(and(eq(doubleMatches.id, doubleId), isNull(doubleMatches.closedAt)))
      .returning({ members: doubleMatches.members });
    for (const m of row?.members ?? []) {
      await this.publish(m, { type: 'double.closed', doubleId }).catch(() => undefined);
    }
  }

  /** An account that lost access (suspension, ban) leaves its pair and every double chat. */
  async closeForUser(userId: string): Promise<void> {
    await this.leavePair(userId);
    const open = await this.db
      .select({ id: doubleMatches.id })
      .from(doubleMatches)
      .where(and(isNull(doubleMatches.closedAt), sql`${userId} = ANY(${doubleMatches.members})`));
    for (const d of open) await this.close(d.id, userId);
  }

  /** Blocks (phase 22): a block between any two of the four closes their double chats. */
  async closeForBlock(a: string, b: string): Promise<void> {
    const open = await this.db
      .select({ id: doubleMatches.id })
      .from(doubleMatches)
      .where(
        and(
          isNull(doubleMatches.closedAt),
          sql`${doubleMatches.members} @> ARRAY[${a}, ${b}]::text[]`,
        ),
      );
    for (const d of open) await this.close(d.id, a);
  }
}
