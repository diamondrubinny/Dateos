// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { ErrorCode, STAFF_MFA_TTL_MS, type StaffMe, type StaffRole } from '@nexaheart/shared';
import { eq, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from '../../lib/totp.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { AuthUser } from '../../auth/session.js';

const { staffMfa, staffSessions } = schema;

/** After this many wrong codes in a row, MFA is locked until an operator resets it (CLI). */
export const MAX_MFA_FAILURES = 10;

export function isStaffRole(role: string): role is StaffRole {
  return role === 'moderator' || role === 'admin';
}

export class StaffMfaService {
  private readonly key: Buffer;

  constructor(
    private readonly db: Database,
    masterSecret: string,
    private readonly issuer: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = deriveKey(masterSecret, 'staff-mfa');
  }

  async status(staff: AuthUser): Promise<StaffMe> {
    const [mfa] = await this.db.select().from(staffMfa).where(eq(staffMfa.userId, staff.id));
    return {
      role: staff.role as StaffRole,
      mfaEnabled: Boolean(mfa?.enabledAt),
      mfaVerified: Boolean(mfa?.enabledAt) && (await this.sessionVerified(staff.sessionId)),
    };
  }

  private async sessionVerified(sessionId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ at: staffSessions.mfaVerifiedAt })
      .from(staffSessions)
      .where(eq(staffSessions.sessionId, sessionId));
    return Boolean(row && this.now() - row.at.getTime() < STAFF_MFA_TTL_MS);
  }

  /** Throws unless this session passed a TOTP check recently. */
  async requireVerified(staff: AuthUser): Promise<void> {
    const status = await this.status(staff);
    if (!status.mfaVerified) {
      throw new HttpError(403, ErrorCode.MfaRequired, 'Two-factor verification required.');
    }
  }

  /**
   * Creates (or replaces) a pending secret. Once MFA is enabled it can only be reset by an
   * operator from the server CLI, so a stolen session cannot re-enrol a new device.
   */
  async setup(staff: AuthUser): Promise<{ secret: string; otpauthUrl: string }> {
    const [existing] = await this.db.select().from(staffMfa).where(eq(staffMfa.userId, staff.id));
    if (existing?.enabledAt) {
      throw new HttpError(409, ErrorCode.Conflict, 'Two-factor authentication is already set up.');
    }
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(this.key, secret);
    await this.db
      .insert(staffMfa)
      .values({ userId: staff.id, secret: encrypted })
      .onConflictDoUpdate({
        target: staffMfa.userId,
        set: { secret: encrypted, lastStep: 0, failedAttempts: 0 },
      });
    return { secret, otpauthUrl: otpauthUrl(this.issuer, staff.email, secret) };
  }

  async verify(staff: AuthUser, code: string): Promise<void> {
    const [mfa] = await this.db.select().from(staffMfa).where(eq(staffMfa.userId, staff.id));
    if (!mfa)
      throw new HttpError(409, ErrorCode.Conflict, 'Set up two-factor authentication first.');
    const invalid = () => new HttpError(400, ErrorCode.BadRequest, 'The code is not valid.');
    if (mfa.failedAttempts >= MAX_MFA_FAILURES) {
      throw new HttpError(
        403,
        ErrorCode.Forbidden,
        'Two-factor authentication is locked. Ask an operator to reset it.',
      );
    }
    const step = verifyTotp(decryptSecret(this.key, mfa.secret), code, this.now(), mfa.lastStep);
    if (step === null) {
      await this.db
        .update(staffMfa)
        .set({ failedAttempts: sql`${staffMfa.failedAttempts} + 1` })
        .where(eq(staffMfa.userId, staff.id));
      await audit(this.db, {
        actorId: staff.id,
        action: 'staff.mfa_failed',
        targetType: 'user',
        targetId: staff.id,
      });
      throw invalid();
    }
    const enabling = !mfa.enabledAt;
    await this.db.transaction(async (tx) => {
      // Conditional on the old step so two parallel requests cannot both use one code.
      const updated = await tx
        .update(staffMfa)
        .set({ lastStep: step, failedAttempts: 0, ...(enabling ? { enabledAt: new Date() } : {}) })
        .where(sql`${staffMfa.userId} = ${staff.id} AND ${staffMfa.lastStep} < ${step}`)
        .returning({ userId: staffMfa.userId });
      if (updated.length === 0) throw invalid();
      await tx
        .insert(staffSessions)
        .values({
          sessionId: staff.sessionId,
          userId: staff.id,
          mfaVerifiedAt: new Date(this.now()),
        })
        .onConflictDoUpdate({
          target: staffSessions.sessionId,
          set: { mfaVerifiedAt: new Date(this.now()) },
        });
      await audit(tx, {
        actorId: staff.id,
        action: enabling ? 'staff.mfa_enabled' : 'staff.mfa_verified',
        targetType: 'user',
        targetId: staff.id,
      });
    });
  }
}
