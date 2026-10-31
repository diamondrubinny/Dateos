// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  CHAPERONE_LINK_DAYS,
  ErrorCode,
  type ChaperoneTranscript,
  type Chaperoning,
  type ChatChaperones,
  type MyChaperone,
} from '@nexaheart/shared';
import { eq, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import { createLink, linkOwner, useLink } from '../friends/links.js';

const { chaperones } = schema;
const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/**
 * Phase 68d: a chaperone (wali) a member invites. Read-only access to the member's dating chats,
 * only messages sent after the chaperone joined, text only; both sides of every chat see a notice.
 */
export class ChaperoneService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  async mine(userId: string): Promise<MyChaperone> {
    const { rows } = await this.db.execute<{
      display_name: string;
      started_at: Date;
      last_viewed_at: Date | null;
    }>(sql`
      SELECT p.display_name, c.started_at, c.last_viewed_at FROM chaperones c
      JOIN profiles p ON p.user_id = c.chaperone_id WHERE c.user_id = ${userId}`);
    const r = rows[0];
    return {
      chaperone: r
        ? {
            displayName: r.display_name,
            since: iso(r.started_at)!,
            lastViewedAt: iso(r.last_viewed_at),
          }
        : null,
    };
  }

  async invite(userId: string): Promise<{ token: string; expiresAt: string }> {
    return createLink(this.db, userId, 'wali', CHAPERONE_LINK_DAYS, this.now());
  }

  async linkInfo(token: string): Promise<{ memberName: string }> {
    const owner = await linkOwner(this.db, token, 'wali', this.now());
    if (!owner) throw notFound();
    const { rows } = await this.db.execute<{ name: string }>(
      sql`SELECT display_name AS name FROM profiles WHERE user_id = ${owner}`,
    );
    if (!rows[0]) throw notFound();
    return { memberName: rows[0].name };
  }

  /** The invited person accepts (signed in, with a profile). One chaperone per member. */
  async join(chaperoneId: string, token: string): Promise<void> {
    const owner = await linkOwner(this.db, token, 'wali', this.now());
    if (!owner || owner === chaperoneId) throw notFound();
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: chaperones.userId })
        .from(chaperones)
        .where(eq(chaperones.userId, owner));
      if (existing) {
        throw new HttpError(409, ErrorCode.Conflict, 'They already have a chaperone.');
      }
      if (!(await useLink(tx, token, 'wali', this.now()))) throw notFound();
      // The database's clock, like the messages' own times.
      await tx.insert(chaperones).values({ userId: owner, chaperoneId });
      await audit(tx, {
        actorId: chaperoneId,
        action: 'chaperone.joined',
        targetType: 'user',
        targetId: owner,
      });
    });
  }

  /** The member removes their chaperone: access ends at once. */
  async remove(userId: string): Promise<void> {
    const removed = await this.db
      .delete(chaperones)
      .where(eq(chaperones.userId, userId))
      .returning({ id: chaperones.chaperoneId });
    if (removed.length === 0) throw notFound();
    await audit(this.db, {
      actorId: userId,
      action: 'chaperone.removed',
      targetType: 'user',
      targetId: removed[0]!.id,
    });
  }

  /** The chaperone steps down. */
  async stepDown(chaperoneId: string, memberId: string): Promise<void> {
    const { rows } = await this.db.execute(sql`
      DELETE FROM chaperones WHERE user_id = ${memberId} AND chaperone_id = ${chaperoneId}
      RETURNING user_id`);
    if (rows.length === 0) throw notFound();
    await audit(this.db, {
      actorId: chaperoneId,
      action: 'chaperone.stepped_down',
      targetType: 'user',
      targetId: memberId,
    });
  }

  async chaperoning(chaperoneId: string): Promise<Chaperoning> {
    const { rows } = await this.db.execute<{
      user_id: string;
      display_name: string;
      started_at: Date;
      chats: { matchId: string; otherName: string }[] | null;
    }>(sql`
      SELECT c.user_id, p.display_name, c.started_at,
        (SELECT json_agg(json_build_object('matchId', m.id, 'otherName', op.display_name)
                ORDER BY m.created_at DESC)
           FROM matches m
           JOIN profiles op ON op.user_id = CASE WHEN m.user_a = c.user_id THEN m.user_b ELSE m.user_a END
          WHERE (m.user_a = c.user_id OR m.user_b = c.user_id)
            AND m.unmatched_at IS NULL AND m.mode = 'date') AS chats
      FROM chaperones c JOIN profiles p ON p.user_id = c.user_id
      JOIN "user" u ON u.id = c.user_id AND u.status = 'active'
      WHERE c.chaperone_id = ${chaperoneId}
      ORDER BY p.display_name`);
    return {
      members: rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        since: iso(r.started_at)!,
        chats: r.chats ?? [],
      })),
    };
  }

  /** One chat, read-only: messages after the start, text only. Each look is audited. */
  async transcript(
    chaperoneId: string,
    memberId: string,
    matchId: string,
  ): Promise<ChaperoneTranscript> {
    const { rows } = await this.db.execute<{
      started_at: Date;
      member_name: string;
      other_id: string;
      other_name: string;
    }>(sql`
      SELECT c.started_at, mp.display_name AS member_name, op.user_id AS other_id,
        op.display_name AS other_name
      FROM chaperones c
      JOIN "user" u ON u.id = c.user_id AND u.status = 'active'
      JOIN matches m ON m.id = ${matchId} AND m.unmatched_at IS NULL AND m.mode = 'date'
        AND (m.user_a = c.user_id OR m.user_b = c.user_id)
      JOIN profiles mp ON mp.user_id = c.user_id
      JOIN profiles op ON op.user_id = CASE WHEN m.user_a = c.user_id THEN m.user_b ELSE m.user_a END
      WHERE c.user_id = ${memberId} AND c.chaperone_id = ${chaperoneId}`);
    const head = rows[0];
    if (!head) throw notFound();
    const { rows: messages } = await this.db.execute<{
      id: string;
      sender_id: string;
      kind: string;
      body: string | null;
      created_at: Date;
    }>(sql`
      SELECT id, sender_id, kind::text AS kind, body, created_at FROM messages
      WHERE match_id = ${matchId} AND created_at >= ${new Date(head.started_at).toISOString()}::timestamptz
        AND unsent_at IS NULL
      ORDER BY created_at, id LIMIT 500`);
    await this.db.execute(sql`
      UPDATE chaperones SET last_viewed_at = now() WHERE user_id = ${memberId}`);
    await audit(this.db, {
      actorId: chaperoneId,
      action: 'chaperone.viewed',
      targetType: 'user',
      targetId: memberId,
    });
    return {
      memberName: head.member_name,
      otherName: head.other_name,
      since: iso(head.started_at)!,
      messages: messages.map((m) => ({
        id: m.id,
        fromMember: m.sender_id === memberId,
        kind: m.kind as ChaperoneTranscript['messages'][number]['kind'],
        // Text only: photos, voice, date cards and calls show as a placeholder.
        text: m.kind === 'text' ? m.body : null,
        createdAt: iso(m.created_at)!,
      })),
    };
  }

  /** For the chat page: the notice both people see. */
  async forChat(viewerId: string, otherId: string): Promise<ChatChaperones> {
    const { rows } = await this.db.execute<{
      user_id: string;
      display_name: string;
      started_at: Date;
    }>(sql`
      SELECT c.user_id, p.display_name, c.started_at FROM chaperones c
      JOIN profiles p ON p.user_id = c.chaperone_id
      WHERE c.user_id IN (${viewerId}, ${otherId})`);
    const of = (id: string) => {
      const r = rows.find((x) => x.user_id === id);
      return r ? { displayName: r.display_name, since: iso(r.started_at)! } : null;
    };
    return { mine: of(viewerId), theirs: of(otherId) };
  }
}
