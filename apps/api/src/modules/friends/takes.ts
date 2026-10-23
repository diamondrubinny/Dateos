// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm, containsContactOrLink } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  MAX_TAKES,
  TAKE_LINK_DAYS,
  type FriendTake,
  type TakeRelation,
  type WriteTakeInput,
} from '@nexaheart/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import { createLink, linkOwner, useLink } from './links.js';

const { friendTakes, profiles, user } = schema;
const deadLink = () =>
  new HttpError(404, ErrorCode.NotFound, 'This link doesn’t work any more. Ask for a new one.');

/**
 * Friends' takes (phase 22): a friend writes a few words about a member through a one-time link,
 * without an account; the member approves each one before it's shown (at most three).
 */
export class TakeService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  createLink(ownerId: string) {
    return createLink(this.db, ownerId, 'take', TAKE_LINK_DAYS, this.now());
  }

  /** Public: only the member's first name, and only for a working link of an active member. */
  async linkInfo(token: string): Promise<{ name: string }> {
    const ownerId = await linkOwner(this.db, token, 'take', this.now());
    const name = ownerId ? await this.activeName(ownerId) : null;
    if (!name) throw deadLink();
    return { name };
  }

  private async activeName(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: profiles.displayName })
      .from(profiles)
      .innerJoin(user, eq(user.id, profiles.userId))
      .where(and(eq(profiles.userId, userId), eq(user.status, 'active')));
    return row ? row.name.split(/\s+/)[0]! : null;
  }

  /** Public: the friend's take, through the usual filters; the link is used up. */
  async write(token: string, input: WriteTakeInput): Promise<void> {
    const text = `${input.name} ${input.text}`;
    if (checkHarm(text).flagged) {
      throw new HttpError(422, ErrorCode.ValidationError, 'Please choose kinder words.');
    }
    if (containsContactOrLink(text)) {
      throw new HttpError(
        422,
        ErrorCode.ValidationError,
        'Please leave out links, phone numbers, emails and handles.',
      );
    }
    await this.db.transaction(async (tx) => {
      const ownerId = await useLink(tx, token, 'take', this.now());
      if (!ownerId || !(await this.activeName(ownerId))) throw deadLink();
      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(friendTakes)
        .where(eq(friendTakes.ownerId, ownerId))) as [{ n: number }];
      if (n >= MAX_TAKES) throw deadLink();
      await tx.insert(friendTakes).values({
        ownerId,
        name: input.name,
        relation: input.relation,
        text: input.text,
      });
    });
  }

  async list(ownerId: string): Promise<FriendTake[]> {
    const rows = await this.db
      .select()
      .from(friendTakes)
      .where(eq(friendTakes.ownerId, ownerId))
      .orderBy(desc(friendTakes.createdAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      relation: r.relation as TakeRelation,
      text: r.text,
      status: r.status as FriendTake['status'],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async approve(ownerId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(friendTakes)
      .set({ status: 'approved', decidedAt: new Date(this.now()) })
      .where(and(eq(friendTakes.id, id), eq(friendTakes.ownerId, ownerId)))
      .returning({ id: friendTakes.id });
    if (!row) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
  }

  /** Declining or removing deletes the take at once. */
  async remove(ownerId: string, id: string): Promise<void> {
    const [row] = await this.db
      .delete(friendTakes)
      .where(and(eq(friendTakes.id, id), eq(friendTakes.ownerId, ownerId)))
      .returning({ id: friendTakes.id });
    if (!row) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
  }
}
