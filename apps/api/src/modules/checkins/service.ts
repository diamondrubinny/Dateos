// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  checkinAlertEmail,
  CHECKIN_EXTENSIONS,
  CHECKIN_GRACE_MINUTES,
  CHECKIN_MAX_HOURS,
  CHECKINS_PER_DAY,
  ErrorCode,
  maskEmail,
  SOS_PER_CHECKIN,
  type Checkin,
  type CheckinInput,
  type Locale,
} from '@nexaheart/shared';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Mailer } from '../../lib/mailer.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';

const { checkins, matches, profiles } = schema;
type Row = typeof checkins.$inferSelect;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const OPEN = ['active', 'alerted'] as const;

function view(row: Row): Checkin {
  return {
    id: row.id,
    status: row.status,
    matchName: row.matchName,
    place: row.place,
    startsAt: row.startsAt.toISOString(),
    checkAt: row.checkAt.toISOString(),
    contactName: row.contactName,
    contactEmailMasked: maskEmail(row.contactEmail),
    note: row.note,
    sosCount: row.sosCount,
    extensionsLeft: Math.max(0, CHECKIN_EXTENSIONS - row.extensions),
  };
}

/**
 * Safety check-ins: the member's own date details, a time to confirm being OK, and a trusted contact
 * who is emailed only when the check-in is missed or SOS is pressed (docs/phases/PHASE-9.md).
 */
export class CheckinService {
  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly instanceName: () => Promise<string>,
    private readonly onMailError: (error: unknown) => void,
  ) {}

  async create(userId: string, input: CheckinInput): Promise<Checkin> {
    let matchName: string | null = null;
    if (input.matchId) {
      const [row] = await this.db
        .select({ name: profiles.displayName })
        .from(matches)
        .innerJoin(
          profiles,
          sql`${profiles.userId} = CASE WHEN ${matches.userA} = ${userId} THEN ${matches.userB} ELSE ${matches.userA} END`,
        )
        .where(
          and(
            eq(matches.id, input.matchId),
            isNull(matches.unmatchedAt),
            or(eq(matches.userA, userId), eq(matches.userB, userId)),
          ),
        );
      if (!row) throw notFound();
      matchName = row.name;
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`checkins:${userId}`}))`);
      const [open] = await tx
        .select({ id: checkins.id })
        .from(checkins)
        .where(and(eq(checkins.userId, userId), inArray(checkins.status, OPEN)));
      if (open)
        throw new HttpError(409, ErrorCode.Conflict, 'You already have an active check-in.');
      const [{ count }] = (
        await tx.execute<{ count: number }>(sql`
          SELECT count(*)::int AS count FROM checkins
          WHERE user_id = ${userId} AND created_at > now() - interval '1 day'`)
      ).rows as [{ count: number }];
      if (count >= CHECKINS_PER_DAY) {
        throw new HttpError(429, ErrorCode.RateLimited, 'Too many check-ins today.');
      }
      const [row] = await tx
        .insert(checkins)
        .values({
          userId,
          matchId: input.matchId ?? null,
          matchName,
          place: input.place,
          note: input.note || null,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          locale: input.locale,
          timeZone: input.timeZone,
          startsAt: new Date(input.startsAt),
          checkAt: new Date(input.checkAt),
        })
        .returning();
      return view(row!);
    });
  }

  async active(userId: string): Promise<Checkin | null> {
    const [row] = await this.db
      .select()
      .from(checkins)
      .where(and(eq(checkins.userId, userId), inArray(checkins.status, OPEN)))
      .orderBy(desc(checkins.createdAt))
      .limit(1);
    return row ? view(row) : null;
  }

  private async own(userId: string, id: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(checkins)
      .where(and(eq(checkins.id, id), eq(checkins.userId, userId), inArray(checkins.status, OPEN)));
    if (!row) throw notFound();
    return row;
  }

  /** "I'm OK": ends the check-in; nothing is sent to the contact. */
  async ok(userId: string, id: string): Promise<void> {
    await this.own(userId, id);
    await this.db
      .update(checkins)
      .set({ status: 'ok', endedAt: new Date() })
      .where(and(eq(checkins.id, id), inArray(checkins.status, OPEN)));
  }

  /**
   * "Running late" (phase 45): moves the check-in time later, from now or from the current time,
   * whichever is later. Only before the contact is emailed, a few times, and never past
   * CHECKIN_MAX_HOURS from the start. One UPDATE decides it: if the worker is alerting the contact
   * right now, it waits for that transaction and then finds the check-in no longer active.
   */
  async extend(userId: string, id: string, minutes: number): Promise<Checkin> {
    const row = await this.own(userId, id);
    const [updated] = await this.db
      .update(checkins)
      .set({
        checkAt: sql`GREATEST(${checkins.checkAt}, now()) + make_interval(mins => ${minutes})`,
        extensions: sql`${checkins.extensions} + 1`,
        // The reminder comes again at the new time.
        remindedAt: null,
      })
      .where(
        and(
          eq(checkins.id, row.id),
          eq(checkins.status, 'active'),
          sql`${checkins.checkAt} > now() - make_interval(mins => ${CHECKIN_GRACE_MINUTES})`,
          sql`${checkins.extensions} < ${CHECKIN_EXTENSIONS}`,
          sql`GREATEST(${checkins.checkAt}, now()) + make_interval(mins => ${minutes})
                <= ${checkins.startsAt} + make_interval(hours => ${CHECKIN_MAX_HOURS})`,
        ),
      )
      .returning();
    if (updated) return view(updated);
    // Say why: already alerted, no extensions left, or too late in the day.
    const [now] = await this.db.select().from(checkins).where(eq(checkins.id, row.id));
    if (!now || now.status !== 'active') {
      throw new HttpError(409, ErrorCode.Conflict, 'Your contact has already been emailed.');
    }
    if (now.extensions >= CHECKIN_EXTENSIONS) {
      throw new HttpError(429, ErrorCode.RateLimited, 'No more extensions for this check-in.');
    }
    throw new HttpError(
      422,
      ErrorCode.ValidationError,
      `A check-in can last at most ${CHECKIN_MAX_HOURS} hours.`,
    );
  }

  /** Cancelling a check-in deletes it at once (the contact's address with it). */
  async cancel(userId: string, id: string): Promise<void> {
    const row = await this.own(userId, id);
    await this.db.delete(checkins).where(eq(checkins.id, row.id));
  }

  /** Emails the trusted contact now. The check-in stays open until the member says they're OK. */
  async sos(userId: string, id: string): Promise<Checkin> {
    const row = await this.own(userId, id);
    const [updated] = await this.db
      .update(checkins)
      .set({ sosCount: sql`${checkins.sosCount} + 1` })
      .where(and(eq(checkins.id, row.id), sql`${checkins.sosCount} < ${SOS_PER_CHECKIN}`))
      .returning();
    if (!updated) {
      throw new HttpError(429, ErrorCode.RateLimited, 'Your contact has already been alerted.');
    }
    await sendAlert(this.db, this.mailer, await this.instanceName(), updated, true).catch(
      this.onMailError,
    );
    await audit(this.db, {
      actorId: userId,
      action: 'checkin.sos',
      targetType: 'checkin',
      targetId: row.id,
    });
    return view(updated);
  }
}

/** Builds and sends the contact's email (used by the API for SOS and by the worker when missed). */
export async function sendAlert(
  db: Database,
  mailer: Pick<Mailer, 'send'>,
  instanceName: string,
  row: Row,
  sos: boolean,
): Promise<void> {
  const [member] = await db
    .select({ name: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.userId, row.userId));
  const mail = checkinAlertEmail({
    instanceName,
    memberName: member?.name ?? '?',
    contactName: row.contactName,
    matchName: row.matchName,
    place: row.place,
    note: row.note,
    startsAt: row.startsAt,
    checkAt: row.checkAt,
    locale: row.locale as Locale,
    timeZone: row.timeZone,
    sos,
  });
  await mailer.send({ to: row.contactEmail, ...mail });
}
