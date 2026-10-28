// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import type { ReportCategory } from '@nexaheart/shared';
import { and, eq, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';

const { reports } = schema;

/**
 * Why an automatic check opened a report (phase 34). The code goes to the audit log; the words go
 * to the moderator. Nothing is decided automatically: a person reviews every one.
 */
export const autoReasons = {
  same_message: 'Sent the same message to 5 or more chats within 24 hours (possible spam bot).',
  new_account_scam:
    'A new account (under 24 hours) sent links, off-app or money messages to 3 or more chats.',
  like_bursts: 'Liked more than 40 profiles in 10 minutes, 3 times in a day (possible bot).',
  copied_profile_text: 'Profile text identical to another account’s (possible fake profile).',
} as const;
export type AutoReason = keyof typeof autoReasons;

/** The SQL for comparing texts: lowercase, spaces collapsed, trimmed. */
export const normalizedText = (column: unknown) =>
  sql`lower(btrim(regexp_replace(${column}, '\\s+', ' ', 'g')))`;
export const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Opens an automatic report unless one is already open for this account and category, so a flood
 * of signals never floods the moderation queue.
 */
export async function openAutoReport(
  db: Database,
  reportedId: string,
  category: Extract<ReportCategory, 'spam' | 'scam' | 'fake_profile'>,
  priority: 'high' | 'normal',
  reason: AutoReason,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // One check at a time per account and category.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`auto:${reportedId}:${category}`}))`,
    );
    const [open] = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reportedId, reportedId),
          eq(reports.status, 'open'),
          eq(reports.automatic, true),
          eq(reports.category, category),
        ),
      );
    if (open) return false;
    await tx.insert(reports).values({
      reporterId: null,
      reportedId,
      category,
      priority,
      details: autoReasons[reason],
      automatic: true,
    });
    await audit(tx, {
      actorId: null,
      action: 'report.automatic',
      targetType: 'user',
      targetId: reportedId,
      meta: { reason },
    });
    return true;
  });
}
