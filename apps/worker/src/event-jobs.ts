// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { EVENT_REMINDER_HOURS, EVENT_RETENTION_DAYS, RSVP_RETENTION_DAYS } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';

export interface EventJobContext {
  db: Database;
  /** A content-free push to someone going (best effort). */
  remind: (userId: string, eventId: string) => Promise<void>;
  now?: () => Date;
}

/**
 * Runs every 10 minutes: reminds people going EVENT_REMINDER_HOURS before an event (once each),
 * deletes who was going RSVP_RETENTION_DAYS after an event ends, and ended events after a year.
 * Speed dating (phase 23): the lobby is emptied once an event ends, and the rounds (with their
 * private answers) go with the RSVPs.
 */
export async function processEvents(ctx: EventJobContext): Promise<{
  reminded: number;
  rsvpsDeleted: number;
  eventsDeleted: number;
  speedDatesDeleted: number;
}> {
  const now = ctx.now?.() ?? new Date();
  const due = await ctx.db.execute<{ user_id: string; event_id: string }>(sql`
    UPDATE event_rsvps r SET reminded_at = ${now}
    FROM events e
    WHERE e.id = r.event_id AND r.reminded_at IS NULL AND e.status = 'scheduled'
      AND r.status = 'going'
      AND e.starts_at > ${now}
      AND e.starts_at <= ${new Date(now.getTime() + EVENT_REMINDER_HOURS * 3_600_000)}
    RETURNING r.user_id, r.event_id`);
  for (const row of due.rows) await ctx.remind(row.user_id, row.event_id).catch(() => undefined);

  const rsvps = await ctx.db.execute(sql`
    DELETE FROM event_rsvps r USING events e
    WHERE e.id = r.event_id
      AND e.ends_at < ${new Date(now.getTime() - RSVP_RETENTION_DAYS * 86_400_000)}`);
  // Updates and questions to the organizers (phase 27) and "Meet again" choices (71a) go with
  // the RSVPs.
  await ctx.db.execute(sql`
    DELETE FROM event_picks p USING events e
    WHERE e.id = p.event_id
      AND e.ends_at < ${new Date(now.getTime() - RSVP_RETENTION_DAYS * 86_400_000)}`);
  await ctx.db.execute(sql`
    DELETE FROM event_updates u USING events e
    WHERE e.id = u.event_id
      AND e.ends_at < ${new Date(now.getTime() - RSVP_RETENTION_DAYS * 86_400_000)}`);
  await ctx.db.execute(sql`
    DELETE FROM event_questions q USING events e
    WHERE e.id = q.event_id
      AND e.ends_at < ${new Date(now.getTime() - RSVP_RETENTION_DAYS * 86_400_000)}`);
  await ctx.db.execute(sql`
    DELETE FROM speed_lobby l USING events e
    WHERE e.id = l.event_id AND (e.ends_at < ${now} OR e.status = 'cancelled')`);
  const speedDates = await ctx.db.execute(sql`
    DELETE FROM speed_dates d USING events e
    WHERE e.id = d.event_id
      AND e.ends_at < ${new Date(now.getTime() - RSVP_RETENTION_DAYS * 86_400_000)}`);
  const ended = await ctx.db.execute(sql`
    DELETE FROM events
    WHERE ends_at < ${new Date(now.getTime() - EVENT_RETENTION_DAYS * 86_400_000)}`);
  return {
    reminded: due.rows.length,
    rsvpsDeleted: rsvps.rowCount ?? 0,
    eventsDeleted: ended.rowCount ?? 0,
    speedDatesDeleted: speedDates.rowCount ?? 0,
  };
}
