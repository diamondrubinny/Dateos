// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { ErrorCode, type MyTable, type TableAnswers } from '@nexaheart/shared';
import { and, eq, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import { tablesAt } from './service.js';

const { events, eventRsvps } = schema;

type EventRow = typeof events.$inferSelect;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

export interface Seat {
  id: string;
  gender: string;
  answers: TableAnswers;
}

/**
 * Phase 71d: tables of about `size`, sizes differing by at most one, each gender spread evenly
 * across them. Within each gender, people with similar answers sit together: each gender's list,
 * sorted by answers, is cut into one run per table; a run's extra seat goes to the tables with the
 * fewest people so far. Deterministic.
 */
export function assignTables(people: Seat[], size: number): Map<string, number> {
  const result = new Map<string, number>();
  if (people.length === 0) return result;
  const tables = Math.ceil(people.length / size);
  const key = (p: Seat) => `${p.answers.pace}|${p.answers.talk}|${p.answers.drinks}|${p.id}`;
  const byGender = new Map<string, Seat[]>();
  for (const p of people) byGender.set(p.gender, [...(byGender.get(p.gender) ?? []), p]);
  const lists = [...byGender.entries()]
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .map(([, list]) => list.sort((a, b) => key(a).localeCompare(key(b))));
  const counts = Array.from({ length: tables }, () => 0);
  for (const list of lists) {
    const base = Math.floor(list.length / tables);
    const fewest = counts
      .map((n, t) => ({ n, t }))
      .sort((a, b) => a.n - b.n || a.t - b.t)
      .slice(0, list.length % tables)
      .map((x) => x.t);
    let at = 0;
    for (let t = 0; t < tables; t += 1) {
      const n = base + (fewest.includes(t) ? 1 : 0);
      for (const p of list.slice(at, at + n)) result.set(p.id, t + 1);
      counts[t]! += n;
      at += n;
    }
  }
  return result;
}

/** Sets the tables once, when it's time (the reveal, or the start). Safe to call often. */
export async function setTablesIfDue(db: Database, event: EventRow, now: number): Promise<void> {
  if (!event.tableSize || event.tablesSetAt || now < tablesAt(event).getTime()) return;
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(events).where(eq(events.id, event.id)).for('update');
    if (!locked || locked.tablesSetAt || !locked.tableSize) return;
    const { rows } = await tx.execute<{ user_id: string; gender: string; answers: TableAnswers }>(
      sql`SELECT r.user_id, p.gender::text AS gender, r.table_answers AS answers
          FROM event_rsvps r JOIN profiles p ON p.user_id = r.user_id
          WHERE r.event_id = ${event.id} AND r.status = 'going' AND r.table_answers IS NOT NULL`,
    );
    const seats = assignTables(
      rows.map((r) => ({ id: r.user_id, gender: r.gender, answers: r.answers })),
      locked.tableSize,
    );
    for (const [userId, tableNo] of seats) {
      await tx
        .update(eventRsvps)
        .set({ tableNo })
        .where(and(eq(eventRsvps.eventId, event.id), eq(eventRsvps.userId, userId)));
    }
    await tx
      .update(events)
      .set({ tablesSetAt: new Date(now) })
      .where(eq(events.id, event.id));
  });
}

/**
 * Tables by a short questionnaire (phase 71d). Joining a table is optional and is the consent to
 * share a first name with that table; nobody else ever sees a table.
 */
export class TableService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  /** The event (with tables) and my "going" place, or 404. */
  private async access(eventId: string, userId: string) {
    const [row] = await this.db
      .select({ event: events, answers: eventRsvps.tableAnswers, tableNo: eventRsvps.tableNo })
      .from(events)
      .innerJoin(
        eventRsvps,
        and(
          eq(eventRsvps.eventId, events.id),
          eq(eventRsvps.userId, userId),
          eq(eventRsvps.status, 'going'),
        ),
      )
      .where(eq(events.id, eventId));
    if (!row || !row.event.tableSize || row.event.status !== 'scheduled') throw notFound();
    return row;
  }

  async state(eventId: string, userId: string): Promise<MyTable> {
    const first = await this.access(eventId, userId);
    await setTablesIfDue(this.db, first.event, this.now());
    const { event, answers, tableNo } = await this.access(eventId, userId);
    const mates =
      event.tablesSetAt && tableNo !== null
        ? (
            await this.db.execute<{ name: string }>(sql`
              SELECT p.display_name AS name FROM event_rsvps r
              JOIN profiles p ON p.user_id = r.user_id
              JOIN "user" u ON u.id = r.user_id AND u.status = 'active'
              WHERE r.event_id = ${eventId} AND r.table_no = ${tableNo} AND r.status = 'going'
                AND r.user_id <> ${userId}
              ORDER BY p.display_name`)
          ).rows.map((r) => r.name)
        : [];
    return {
      joined: answers !== null,
      answers: (answers as TableAnswers | null) ?? null,
      setAt: tablesAt(event).toISOString(),
      set: event.tablesSetAt !== null,
      tableNo,
      mates,
    };
  }

  private open(event: EventRow) {
    if (event.endsAt.getTime() <= this.now()) {
      throw new HttpError(409, ErrorCode.Conflict, 'This event is over.');
    }
  }

  /** Joining (or changing my answers). After the tables are set, I go to the smallest table. */
  async join(eventId: string, userId: string, answers: TableAnswers): Promise<MyTable> {
    const { event, tableNo } = await this.access(eventId, userId);
    this.open(event);
    await setTablesIfDue(this.db, event, this.now());
    const [fresh] = await this.db.select().from(events).where(eq(events.id, eventId));
    let seat = tableNo;
    if (fresh!.tablesSetAt && seat === null) {
      const { rows } = await this.db.execute<{ table_no: number }>(sql`
        SELECT t.n AS table_no FROM generate_series(1, greatest(1, (
          SELECT coalesce(max(table_no), 1) FROM event_rsvps WHERE event_id = ${eventId}))) AS t(n)
        LEFT JOIN event_rsvps r
          ON r.event_id = ${eventId} AND r.table_no = t.n AND r.status = 'going'
        GROUP BY t.n ORDER BY count(r.user_id), t.n LIMIT 1`);
      seat = rows[0]?.table_no ?? 1;
    }
    await this.db
      .update(eventRsvps)
      .set({ tableAnswers: answers, tableNo: seat })
      .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
    return this.state(eventId, userId);
  }

  /** Leaving the table: my answers and my seat go. */
  async leave(eventId: string, userId: string): Promise<MyTable> {
    const { event } = await this.access(eventId, userId);
    this.open(event);
    await this.db
      .update(eventRsvps)
      .set({ tableAnswers: null, tableNo: null })
      .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
    return this.state(eventId, userId);
  }
}
