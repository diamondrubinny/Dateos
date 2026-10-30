// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  AGE_CHECK_MAX_SKEW_SECONDS,
  AGE_CHECK_SESSION_MINUTES,
  ageCheckSigningString,
  ErrorCode,
  type AgeCheckCallback,
  type AgeCheckState,
} from '@nexaheart/shared';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';

const { ageCheckSessions, ageChecks, instanceSettings, user, session } = schema;

export interface AgeCheckProvider {
  url: string;
  secret: string;
}

/** HMAC-SHA256 of the signing string, hex (what the provider sends). */
export function signAgeCheck(secret: string, callback: AgeCheckCallback): string {
  return createHmac('sha256', secret).update(ageCheckSigningString(callback)).digest('hex');
}

/** Constant-time check of a hex signature. */
export function validAgeCheckSignature(
  secret: string,
  callback: AgeCheckCallback,
  signature: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signAgeCheck(secret, callback), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/**
 * Phase 63: age assurance through the community's provider. Only the result is stored (over 18 or
 * not, the method, when) ⚖️.
 */
export class AgeCheckService {
  constructor(
    private readonly db: Database,
    private readonly provider: AgeCheckProvider | undefined,
    private readonly urls: { api: string; app: string },
    private readonly now: () => number = Date.now,
  ) {}

  get configured(): boolean {
    return this.provider !== undefined;
  }

  /** Required: the community asked for it and a provider is configured. */
  async required(): Promise<boolean> {
    if (!this.provider) return false;
    const [row] = await this.db
      .select({ on: instanceSettings.ageCheckRequired })
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1));
    return row?.on ?? false;
  }

  async passed(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ result: ageChecks.result })
      .from(ageChecks)
      .where(eq(ageChecks.userId, userId));
    return row?.result === 'over_18';
  }

  async state(userId: string): Promise<AgeCheckState> {
    const [row] = await this.db.select().from(ageChecks).where(eq(ageChecks.userId, userId));
    return {
      required: await this.required(),
      status: !row ? 'none' : row.result === 'over_18' ? 'passed' : 'failed',
      checkedAt: row?.checkedAt.toISOString() ?? null,
    };
  }

  /** A one-time session at the provider, and the address to send the member to. */
  async start(userId: string): Promise<{ url: string }> {
    if (!this.provider) {
      throw new HttpError(400, ErrorCode.BadRequest, 'No age-check provider is set up here.');
    }
    const now = new Date(this.now());
    // Old sessions of this member go first; at most one is open at a time.
    await this.db
      .delete(ageCheckSessions)
      .where(and(eq(ageCheckSessions.userId, userId), isNull(ageCheckSessions.usedAt)));
    await this.db.delete(ageCheckSessions).where(lt(ageCheckSessions.expiresAt, now));
    const [row] = await this.db
      .insert(ageCheckSessions)
      .values({
        userId,
        expiresAt: new Date(now.getTime() + AGE_CHECK_SESSION_MINUTES * 60_000),
      })
      .returning({ id: ageCheckSessions.id });
    const url = new URL(this.provider.url);
    url.searchParams.set('session', row!.id);
    url.searchParams.set('return', `${this.urls.app}/onboarding/age-check`);
    url.searchParams.set('callback', `${this.urls.api}/v1/age-check/callback`);
    return { url: url.toString() };
  }

  /** The provider's signed result. Refuses bad signatures, old results, replays and unknown sessions. */
  async receive(callback: AgeCheckCallback, signature: string): Promise<void> {
    const refuse = () => new HttpError(403, ErrorCode.Forbidden, 'Not accepted.');
    if (!this.provider || !validAgeCheckSignature(this.provider.secret, callback, signature)) {
      throw refuse();
    }
    const nowMs = this.now();
    if (Math.abs(nowMs / 1000 - callback.ts) > AGE_CHECK_MAX_SKEW_SECONDS) throw refuse();
    const now = new Date(nowMs);
    await this.db.transaction(async (tx) => {
      const [used] = await tx
        .update(ageCheckSessions)
        .set({ usedAt: now })
        .where(
          and(
            eq(ageCheckSessions.id, callback.session),
            isNull(ageCheckSessions.usedAt),
            gt(ageCheckSessions.expiresAt, now),
          ),
        )
        .returning({ userId: ageCheckSessions.userId });
      if (!used) throw refuse();
      const values = { result: callback.result, method: callback.method, checkedAt: now };
      await tx
        .insert(ageChecks)
        .values({ userId: used.userId, ...values })
        .onConflictDoUpdate({ target: ageChecks.userId, set: values });
      await audit(tx, {
        actorId: null,
        action: `age_check.${callback.result}`,
        targetType: 'user',
        targetId: used.userId,
        meta: { method: callback.method },
      });
      // Under 18: suspended as when the date of birth says so (phase 1).
      if (callback.result === 'under_18') {
        await tx
          .update(user)
          .set({ status: 'suspended', suspendedReason: 'underage' })
          .where(eq(user.id, used.userId));
        await tx.delete(session).where(eq(session.userId, used.userId));
      }
    });
  }
}
