// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { type Database } from '@nexaheart/db';
import {
  ErrorCode,
  federatedSignalRevokeSchema,
  federatedSignalSchema,
  SIGNAL_PHOTO_DISTANCE,
  SIGNAL_REPORT_PREFIX,
} from '@nexaheart/shared';
import { sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { FederationService, IncomingSigned } from './service.js';

/** Signals one partner may send per day, at most. */
const MAX_SIGNALS_PER_DAY = 500;

const badRequest = () => new HttpError(400, ErrorCode.ValidationError, 'Malformed request.');

function parseBody(incoming: IncomingSigned): unknown {
  try {
    return JSON.parse(incoming.body);
  } catch {
    return null;
  }
}

/** This community shares and accepts trust signals (an admin's choice, off by default). */
export const sharesSignalsSql = sql`COALESCE((SELECT share_trust_signals FROM instance_settings WHERE id = 1), false)`;

/**
 * Opens an automatic report, for moderators to review, on a member whose profile photo matches a
 * partner's trust signal. Never hides, rejects or bans anything by itself. One open at a time.
 */
export async function reportSignalMatch(
  db: Pick<Database, 'execute'>,
  userId: string,
  partnerName: string,
  category: string,
): Promise<boolean> {
  const { rows } = await db.execute<{ id: string }>(sql`
    INSERT INTO reports (reporter_id, reported_id, category, priority, details, automatic)
    SELECT NULL, ${userId}, 'fake_profile', 'high',
      ${`${SIGNAL_REPORT_PREFIX} “${partnerName}” banned (${category}). Not proof: it may be a shared or copied photo. Please review before acting.`},
      true
    -- One open at a time; another kind of automatic report doesn't hide this one.
    WHERE NOT EXISTS (SELECT 1 FROM reports
      WHERE reported_id = ${userId} AND status = 'open' AND automatic
        AND details LIKE ${`${SIGNAL_REPORT_PREFIX}%`})
    RETURNING id`);
  if (!rows[0]) return false;
  await audit(db as Database, {
    actorId: null,
    action: 'report.automatic',
    targetType: 'user',
    targetId: userId,
    meta: { reason: 'partner_signal' },
  });
  return true;
}

/**
 * Phase 73b: trust signals from partners. Only photo hashes and a category arrive; they're kept
 * only where this community opted in, and only lead to a review by moderators here.
 */
export class FederatedSignals {
  constructor(
    private readonly db: Database,
    private readonly federation: FederationService,
    private readonly now: () => number = Date.now,
  ) {}

  /** A partner banned someone: keep the hashes and flag members here with a matching photo. */
  async receive(incoming: IncomingSigned): Promise<{ kept: boolean }> {
    const partner = await this.federation.verifyActive(incoming);
    const parsed = federatedSignalSchema.safeParse(parseBody(incoming));
    if (!parsed.success) throw badRequest();
    const { rows: on } = await this.db.execute<{ on: boolean }>(
      sql`SELECT ${sharesSignalsSql} AS on`,
    );
    // Not opted in: nothing is kept (the partner isn't told why).
    if (!on[0]?.on) return { kept: false };
    const since = new Date(this.now() - 24 * 3_600_000).toISOString();
    const { rows: today } = await this.db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT signal_id)::int AS n FROM federation_signals_in
      WHERE partner_id = ${partner.id} AND created_at > ${since}::timestamptz`);
    if ((today[0]?.n ?? 0) >= MAX_SIGNALS_PER_DAY) {
      throw new HttpError(429, ErrorCode.RateLimited, 'Too many signals today.');
    }
    const signal = parsed.data;
    const at = new Date(this.now()).toISOString();
    for (const hash of new Set(signal.hashes)) {
      await this.db.execute(sql`
        INSERT INTO federation_signals_in (partner_id, signal_id, hash, category, created_at)
        VALUES (${partner.id}, ${signal.id}, ${hash}::bigint, ${signal.category}, ${at}::timestamptz)
        ON CONFLICT DO NOTHING`);
    }
    // Members here whose profile photo looks the same: a review, nothing more.
    const { rows: matches } = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT ph.user_id FROM photos ph
      JOIN "user" u ON u.id = ph.user_id
      WHERE ph.phash IS NOT NULL AND ph.status = 'clean' AND ph.purpose = 'profile'
        AND u.status = 'active' AND u.role = 'user'
        AND EXISTS (SELECT 1 FROM federation_signals_in s
          WHERE s.partner_id = ${partner.id} AND s.signal_id = ${signal.id}
            AND bit_count((ph.phash # s.hash)::bit(64)) <= ${SIGNAL_PHOTO_DISTANCE})
      LIMIT 20`);
    for (const m of matches) {
      await reportSignalMatch(this.db, m.user_id, partner.name, signal.category);
    }
    await audit(this.db, {
      actorId: null,
      action: 'federation.signal_received',
      targetType: 'partner',
      targetId: partner.url,
      meta: { hashes: signal.hashes.length, matches: matches.length },
    });
    return { kept: true };
  }

  /** The partner lifted the ban (or an appeal succeeded there): forget the signal. */
  async revoke(incoming: IncomingSigned): Promise<void> {
    const { partner } = await this.federation.verify(incoming);
    if (!partner || (partner.status !== 'active' && partner.status !== 'suspended')) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Not connected.');
    }
    const parsed = federatedSignalRevokeSchema.safeParse(parseBody(incoming));
    if (!parsed.success) throw badRequest();
    await this.db.execute(sql`
      DELETE FROM federation_signals_in
      WHERE partner_id = ${partner.id} AND signal_id = ${parsed.data.id}`);
    await audit(this.db, {
      actorId: null,
      action: 'federation.signal_withdrawn',
      targetType: 'partner',
      targetId: partner.url,
    });
  }
}
