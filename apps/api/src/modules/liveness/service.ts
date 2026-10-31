// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  LIVENESS_MAX_SKEW_SECONDS,
  LIVENESS_SESSION_MINUTES,
  livenessSigningString,
  type LivenessCallback,
  type LivenessResult,
  type LivenessState,
  type VerifyRequestState,
} from '@nexaheart/shared';
import type { StoredObject } from '@nexaheart/storage';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';

const { livenessSessions, livenessChecks, verifyRequests } = schema;

export interface LivenessProvider {
  url: string;
  secret: string;
}

export function signLiveness(secret: string, callback: LivenessCallback): string {
  return createHmac('sha256', secret).update(livenessSigningString(callback)).digest('hex');
}

export function validLivenessSignature(
  secret: string,
  callback: LivenessCallback,
  signature: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signLiveness(secret, callback), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

/**
 * Phase 69: a live check at the community's provider, compared with the member's first profile
 * photo, which the provider may fetch once through the session. Only the result is kept ⚖️.
 */
export class LivenessService {
  constructor(
    private readonly db: Database,
    private readonly provider: LivenessProvider | undefined,
    private readonly urls: { api: string; app: string },
    private readonly openPhoto: (photoId: string, ownerId: string) => Promise<StoredObject>,
    private readonly now: () => number = Date.now,
  ) {}

  async state(userId: string): Promise<LivenessState> {
    const [row] = await this.db
      .select()
      .from(livenessChecks)
      .where(eq(livenessChecks.userId, userId));
    return {
      available: this.provider !== undefined,
      last: row
        ? {
            result: row.result as LivenessResult,
            method: row.method,
            checkedAt: row.checkedAt.toISOString(),
          }
        : null,
    };
  }

  async start(userId: string): Promise<{ url: string }> {
    if (!this.provider) {
      throw new HttpError(400, ErrorCode.BadRequest, 'No live-check provider is set up here.');
    }
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM photos WHERE user_id = ${userId} AND purpose = 'profile' AND status = 'clean'
      ORDER BY position LIMIT 1`);
    if (!rows[0]) {
      throw new HttpError(409, ErrorCode.Conflict, 'Add a profile photo first.');
    }
    const now = new Date(this.now());
    await this.db
      .delete(livenessSessions)
      .where(and(eq(livenessSessions.userId, userId), isNull(livenessSessions.usedAt)));
    await this.db.delete(livenessSessions).where(lt(livenessSessions.expiresAt, now));
    const [row] = await this.db
      .insert(livenessSessions)
      .values({
        userId,
        photoId: rows[0].id,
        expiresAt: new Date(now.getTime() + LIVENESS_SESSION_MINUTES * 60_000),
      })
      .returning({ id: livenessSessions.id });
    const url = new URL(this.provider.url);
    url.searchParams.set('session', row!.id);
    url.searchParams.set('photo', `${this.urls.api}/v1/liveness/sessions/${row!.id}/photo`);
    url.searchParams.set('return', `${this.urls.app}/verify`);
    url.searchParams.set('callback', `${this.urls.api}/v1/liveness/callback`);
    return { url: url.toString() };
  }

  /** The provider fetches the photo to compare with: once, before the result, within the session. */
  async photo(sessionId: string): Promise<StoredObject> {
    const now = new Date(this.now());
    const [row] = await this.db
      .update(livenessSessions)
      .set({ photoFetchedAt: now })
      .where(
        and(
          eq(livenessSessions.id, sessionId),
          isNull(livenessSessions.usedAt),
          isNull(livenessSessions.photoFetchedAt),
          sql`${livenessSessions.expiresAt} > ${now.toISOString()}::timestamptz`,
        ),
      )
      .returning({ userId: livenessSessions.userId, photoId: livenessSessions.photoId });
    if (!row?.photoId) throw notFound();
    return this.openPhoto(row.photoId, row.userId);
  }

  async receive(callback: LivenessCallback, signature: string): Promise<void> {
    const refuse = () => new HttpError(403, ErrorCode.Forbidden, 'Not accepted.');
    if (!this.provider || !validLivenessSignature(this.provider.secret, callback, signature)) {
      throw refuse();
    }
    const nowMs = this.now();
    if (Math.abs(nowMs / 1000 - callback.ts) > LIVENESS_MAX_SKEW_SECONDS) throw refuse();
    const now = new Date(nowMs);
    await this.db.transaction(async (tx) => {
      const [used] = await tx
        .update(livenessSessions)
        .set({ usedAt: now })
        .where(
          and(
            eq(livenessSessions.id, callback.session),
            isNull(livenessSessions.usedAt),
            sql`${livenessSessions.expiresAt} > ${now.toISOString()}::timestamptz`,
          ),
        )
        .returning({
          userId: livenessSessions.userId,
          photoId: livenessSessions.photoId,
          createdAt: livenessSessions.createdAt,
        });
      if (!used) throw refuse();
      const values = { result: callback.result, method: callback.method, checkedAt: now };
      await tx
        .insert(livenessChecks)
        .values({ userId: used.userId, ...values })
        .onConflictDoUpdate({ target: livenessChecks.userId, set: values });
      await audit(tx, {
        actorId: null,
        action: `liveness.${callback.result}`,
        targetType: 'user',
        targetId: used.userId,
        meta: { method: callback.method },
      });
      if (callback.result !== 'passed' || !used.photoId) return;
      // The badge vouches for the photos compared: only if they didn't change since the start.
      await tx.execute(sql`
        UPDATE profiles SET verified_at = now()
        WHERE user_id = ${used.userId}
          AND (photos_changed_at IS NULL OR photos_changed_at < ${used.createdAt.toISOString()}::timestamptz)
          AND EXISTS (SELECT 1 FROM photos WHERE id = ${used.photoId} AND status = 'clean'
                      AND purpose = 'profile')`);
    });
  }

  // ---------------------------------------------------------------- asking kindly to verify

  private async otherIn(matchId: string, userId: string): Promise<string> {
    const { rows } = await this.db.execute<{ other: string }>(sql`
      SELECT CASE WHEN user_a = ${userId} THEN user_b ELSE user_a END AS other
      FROM matches WHERE id = ${matchId} AND unmatched_at IS NULL
        AND (user_a = ${userId} OR user_b = ${userId})`);
    if (!rows[0]) throw notFound();
    return rows[0].other;
  }

  async ask(matchId: string, userId: string): Promise<void> {
    const other = await this.otherIn(matchId, userId);
    const { rows } = await this.db.execute<{ verified: boolean }>(sql`
      SELECT verified_at IS NOT NULL AS verified FROM profiles WHERE user_id = ${other}`);
    if (rows[0]?.verified) {
      throw new HttpError(409, ErrorCode.Conflict, 'They are verified already.');
    }
    const inserted = await this.db
      .insert(verifyRequests)
      .values({ matchId, requesterId: userId })
      .onConflictDoNothing()
      .returning({ matchId: verifyRequests.matchId });
    if (inserted.length === 0) throw new HttpError(409, ErrorCode.Conflict, 'Asked already.');
    await audit(this.db, {
      actorId: userId,
      action: 'verify.asked',
      targetType: 'user',
      targetId: other,
    });
  }

  async forChat(matchId: string, viewerId: string, otherId: string): Promise<VerifyRequestState> {
    const { rows } = await this.db.execute<{
      asked: boolean;
      asked_me: boolean;
      me_verified: boolean;
      other_verified: boolean;
    }>(sql`
      SELECT
        EXISTS (SELECT 1 FROM verify_requests WHERE match_id = ${matchId} AND user_id = ${viewerId}) AS asked,
        EXISTS (SELECT 1 FROM verify_requests WHERE match_id = ${matchId} AND user_id = ${otherId}) AS asked_me,
        (SELECT verified_at IS NOT NULL FROM profiles WHERE user_id = ${viewerId}) AS me_verified,
        (SELECT verified_at IS NOT NULL FROM profiles WHERE user_id = ${otherId}) AS other_verified`);
    const r = rows[0]!;
    return {
      asked: r.asked,
      askedMe: r.asked_me && !r.me_verified,
      canAsk: !r.asked && !r.other_verified,
    };
  }
}
