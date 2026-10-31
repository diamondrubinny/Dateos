// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { ErrorCode, type MeetAgain } from '@nexaheart/shared';
import { and, eq, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import type { DiscoveryService } from '../discovery/service.js';
import { meetAgainUntil } from './service.js';

const { events, eventRsvps, eventPicks } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const closed = () =>
  new HttpError(
    409,
    ErrorCode.Conflict,
    '“Meet again” opens when the event ends and stays open for 3 days.',
  );

/**
 * "Meet again" after an in-person event (phase 71a): people who checked in and joined it see each
 * other (only those they could see anyway, both ways) and privately choose whom they'd like to
 * meet again. Only a mutual choice becomes a match, as in video speed dating; a one-sided choice
 * is never shown to anyone.
 */
export class MeetAgainService {
  constructor(
    private readonly db: Database,
    private readonly discovery: DiscoveryService,
    private readonly now: () => number = Date.now,
  ) {}

  /** The event and my RSVP, only if I checked in; open = within the window. */
  private async access(eventId: string, userId: string) {
    const [row] = await this.db
      .select({ event: events, meetAgainAt: eventRsvps.meetAgainAt })
      .from(events)
      .innerJoin(eventRsvps, and(eq(eventRsvps.eventId, events.id), eq(eventRsvps.userId, userId)))
      .where(and(eq(events.id, eventId), sql`${eventRsvps.checkedInAt} IS NOT NULL`));
    if (!row || row.event.kind === 'speed' || row.event.status !== 'scheduled') throw notFound();
    const until = meetAgainUntil(row.event, true, this.now());
    if (!until) throw closed();
    return { until, joined: row.meetAgainAt !== null };
  }

  /** Who else checked in and joined, and whom I may see (and who may see me). */
  private async people(eventId: string, userId: string) {
    const { rows } = await this.db.execute<{ user_id: string; display_name: string }>(sql`
      SELECT r.user_id, p.display_name
      FROM event_rsvps r
      JOIN "user" u ON u.id = r.user_id AND u.status = 'active'
      JOIN profiles p ON p.user_id = r.user_id
      WHERE r.event_id = ${eventId} AND r.user_id <> ${userId}
        AND r.checked_in_at IS NOT NULL AND r.meet_again_at IS NOT NULL
      ORDER BY p.display_name, r.user_id`);
    const visible = [];
    for (const row of rows) {
      if (
        (await this.discovery.canView(userId, row.user_id)) &&
        (await this.discovery.canView(row.user_id, userId))
      ) {
        visible.push(row);
      }
    }
    return visible;
  }

  async state(eventId: string, userId: string): Promise<MeetAgain> {
    const { until, joined } = await this.access(eventId, userId);
    if (!joined) return { joined, closesAt: until.toISOString(), people: [] };
    const people = await this.people(eventId, userId);
    const picks = await this.db.execute<{ target_id: string; mutual: boolean }>(sql`
      SELECT p.target_id, EXISTS (
        SELECT 1 FROM event_picks b
        WHERE b.event_id = p.event_id AND b.user_id = p.target_id AND b.target_id = p.user_id
      ) AS mutual
      FROM event_picks p WHERE p.event_id = ${eventId} AND p.user_id = ${userId}`);
    const mine = new Map(picks.rows.map((p) => [p.target_id, p.mutual]));
    const matchIds = await this.matchIds(
      userId,
      [...mine].filter(([, mutual]) => mutual).map(([id]) => id),
    );
    return {
      joined,
      closesAt: until.toISOString(),
      people: people.map((p) => ({
        userId: p.user_id,
        displayName: p.display_name,
        picked: mine.has(p.user_id),
        // Only mutual choices reveal anything: the match both of us now have.
        matchId: matchIds.get(p.user_id) ?? null,
      })),
    };
  }

  private async matchIds(userId: string, others: string[]): Promise<Map<string, string>> {
    if (others.length === 0) return new Map();
    const list = sql.join(
      others.map((o) => sql`${o}`),
      sql`, `,
    );
    const { rows } = await this.db.execute<{ id: string; other: string }>(sql`
      SELECT m.id, CASE WHEN m.user_a = ${userId} THEN m.user_b ELSE m.user_a END AS other
      FROM matches m
      WHERE m.unmatched_at IS NULL
        AND ((m.user_a = ${userId} AND m.user_b IN (${list}))
          OR (m.user_b = ${userId} AND m.user_a IN (${list})))`);
    return new Map(rows.map((r) => [r.other, r.id]));
  }

  /** Joining lists me to the others who joined; until then nobody sees me there. */
  async join(eventId: string, userId: string): Promise<MeetAgain> {
    const { joined } = await this.access(eventId, userId);
    if (!joined) {
      await this.db
        .update(eventRsvps)
        .set({ meetAgainAt: new Date(this.now()) })
        .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
    }
    return this.state(eventId, userId);
  }

  /** "I'd like to meet again" (or take it back). Both choosing each other makes a match. */
  async pick(eventId: string, userId: string, targetId: string, yes: boolean): Promise<MeetAgain> {
    const { joined } = await this.access(eventId, userId);
    if (!joined || !(await this.people(eventId, userId)).some((p) => p.user_id === targetId)) {
      throw notFound();
    }
    if (!yes) {
      await this.db
        .delete(eventPicks)
        .where(
          and(
            eq(eventPicks.eventId, eventId),
            eq(eventPicks.userId, userId),
            eq(eventPicks.targetId, targetId),
          ),
        );
      return this.state(eventId, userId);
    }
    await this.db
      .insert(eventPicks)
      .values({ eventId, userId, targetId, createdAt: new Date(this.now()) })
      .onConflictDoNothing();
    const [back] = await this.db
      .select({ userId: eventPicks.userId })
      .from(eventPicks)
      .where(
        and(
          eq(eventPicks.eventId, eventId),
          eq(eventPicks.userId, targetId),
          eq(eventPicks.targetId, userId),
        ),
      );
    if (back && (await this.matchIds(userId, [targetId])).size === 0) {
      await this.discovery.matchFromSpeedDate(userId, targetId);
    }
    return this.state(eventId, userId);
  }
}
