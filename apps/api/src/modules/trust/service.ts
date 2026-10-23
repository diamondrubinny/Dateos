// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash, randomInt } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  MEMBER_INVITES,
  normalizeEmail,
  normalizeInviteCode,
  SIGNUP_ALLOWANCE_DAYS,
  type CreateInviteInput,
  type Invite,
  type SignupMode,
  type WaitlistEntry,
  type WaitlistStatus,
} from '@nexaheart/shared';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { appUrl, type Env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import type { EmailHasher } from '../../lib/banned.js';
import { signupClosedEmail, waitlistApprovedEmail, type Mailer } from '../../lib/mailer.js';
import type { AuthUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { InstanceService } from '../instance/service.js';

const { contactHides, inviteCodes, signupAllowances, waitlist, user, profiles } = schema;
const DAY = 86_400_000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** One message for every code that can't be used: it doesn't say which check failed. */
const badCode = () => new HttpError(400, ErrorCode.BadRequest, 'This invite code does not work.');

export function newInviteCode(): string {
  return Array.from(
    { length: INVITE_CODE_LENGTH },
    () => INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)],
  ).join('');
}

/**
 * Trust and safety (phase 21): hide me from my contacts, and who may open a new account (open, an
 * invite code, or a waitlist).
 */
export class TrustService {
  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly instance: InstanceService,
    private readonly mailer: Mailer,
    /** Keyed hash for sign-up permissions and the waitlist (not reversible, not guessable). */
    private readonly hashEmail: EmailHasher,
    private readonly onMailError: (error: unknown) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  // -------------------------------------------------------------- hide me from my contacts

  /**
   * Compares the device's hashes with the members' addresses in memory. Only matches are stored;
   * every other hash is dropped with the request and never logged.
   */
  async hideContacts(userId: string, hashes: string[]): Promise<{ hidden: number }> {
    const wanted = new Set(hashes);
    const members = await this.db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(and(ne(user.id, userId), eq(user.role, 'user')));
    const matched = members
      .filter((m) => wanted.has(sha256(normalizeEmail(m.email))))
      .map((m) => m.id);
    if (matched.length > 0) {
      await this.db
        .insert(contactHides)
        .values(matched.map((otherId) => ({ userId, otherId })))
        .onConflictDoNothing();
    }
    return { hidden: await this.contactHideCount(userId) };
  }

  async contactHideCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(contactHides)
      .where(eq(contactHides.userId, userId));
    return row?.n ?? 0;
  }

  async clearContactHides(userId: string): Promise<void> {
    await this.db.delete(contactHides).where(eq(contactHides.userId, userId));
  }

  // -------------------------------------------------------------- who may sign up

  async mode(): Promise<SignupMode> {
    return (await this.instance.signupSettings()).mode;
  }

  /**
   * Called by the auth hook before a new account is created: true when sign-up is open or this
   * address holds a current permission (a redeemed code or an approved waitlist entry).
   */
  async mayCreateAccount(email: string): Promise<boolean> {
    if ((await this.mode()) === 'open') return true;
    const [row] = await this.db
      .select({ h: signupAllowances.emailHash })
      .from(signupAllowances)
      .where(
        and(
          eq(signupAllowances.emailHash, this.hashEmail(email)),
          gt(signupAllowances.expiresAt, new Date(this.now())),
        ),
      );
    return Boolean(row);
  }

  /** After the account exists, its permission is used up. */
  async consumeAllowance(email: string): Promise<void> {
    await this.db
      .delete(signupAllowances)
      .where(eq(signupAllowances.emailHash, this.hashEmail(email)));
  }

  /**
   * In invite or waitlist mode, a sign-in request for an address without an account or permission
   * gets a "how to join" email instead of a link that would fail. The response is the same.
   */
  async signInBlockedFor(email: string): Promise<'invite' | 'waitlist' | null> {
    const mode = await this.mode();
    if (mode === 'open') return null;
    const [existing] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()));
    if (existing || (await this.mayCreateAccount(email))) return null;
    return mode;
  }

  sendSignupClosed(email: string, mode: 'invite' | 'waitlist'): void {
    this.instance
      .info()
      .then((info) =>
        this.mailer.send({ to: email, ...signupClosedEmail(info.name, mode, appUrl(this.env)) }),
      )
      .catch(this.onMailError);
  }

  /** A code lets one email address open an account for SIGNUP_ALLOWANCE_DAYS. */
  async redeem(code: string, email: string): Promise<void> {
    if ((await this.mode()) !== 'invite') throw badCode();
    const normalized = normalizeInviteCode(code);
    if (normalized.length !== INVITE_CODE_LENGTH) throw badCode();
    const now = new Date(this.now());
    await this.db.transaction(async (tx) => {
      // One atomic update: parallel redemptions can't go past maxUses.
      const [invite] = await tx
        .update(inviteCodes)
        .set({ uses: sql`${inviteCodes.uses} + 1` })
        .where(
          and(
            eq(inviteCodes.codeHash, sha256(normalized)),
            isNull(inviteCodes.revokedAt),
            sql`${inviteCodes.uses} < ${inviteCodes.maxUses}`,
            sql`(${inviteCodes.expiresAt} IS NULL OR ${inviteCodes.expiresAt} > ${now})`,
          ),
        )
        .returning({ id: inviteCodes.id });
      if (!invite) throw badCode();
      const values = {
        emailHash: this.hashEmail(email),
        inviteId: invite.id,
        expiresAt: new Date(now.getTime() + SIGNUP_ALLOWANCE_DAYS * DAY),
      };
      await tx
        .insert(signupAllowances)
        .values(values)
        .onConflictDoUpdate({ target: signupAllowances.emailHash, set: values });
    });
  }

  /** Always accepted, so nobody can learn whether an address is already waiting or a member. */
  async joinWaitlist(email: string, note: string | undefined): Promise<void> {
    if ((await this.mode()) !== 'waitlist') return;
    const address = email.trim().toLowerCase();
    const [member] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, address));
    if (member) return;
    await this.db
      .insert(waitlist)
      .values({ email: address, emailHash: this.hashEmail(email), note: note || null })
      .onConflictDoNothing();
  }

  // -------------------------------------------------------------- invite codes

  private toInvite(row: typeof inviteCodes.$inferSelect, code?: string): Invite {
    return {
      id: row.id,
      label: row.label,
      ...(code ? { code } : {}),
      maxUses: row.maxUses,
      uses: row.uses,
      expiresAt: iso(row.expiresAt),
      revokedAt: iso(row.revokedAt),
      byMember: row.byMember,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async insertInvite(values: {
    createdBy: string;
    byMember: boolean;
    label: string | null;
    maxUses: number;
    expiresAt: Date | null;
  }): Promise<Invite> {
    const code = newInviteCode();
    const [row] = await this.db
      .insert(inviteCodes)
      .values({ ...values, codeHash: sha256(code) })
      .returning();
    return this.toInvite(row!, code);
  }

  async createInvite(staff: AuthUser, input: CreateInviteInput): Promise<Invite> {
    if (staff.role !== 'admin') throw new HttpError(403, ErrorCode.Forbidden, 'Admins only.');
    const invite = await this.insertInvite({
      createdBy: staff.id,
      byMember: false,
      label: input.label || null,
      maxUses: input.maxUses,
      expiresAt: input.expiresInDays ? new Date(this.now() + input.expiresInDays * DAY) : null,
    });
    await audit(this.db, {
      actorId: staff.id,
      action: 'invite.created',
      targetType: 'invite',
      targetId: invite.id,
      meta: { maxUses: input.maxUses },
    });
    return invite;
  }

  async listInvites(): Promise<Invite[]> {
    const rows = await this.db
      .select()
      .from(inviteCodes)
      .orderBy(desc(inviteCodes.createdAt))
      .limit(200);
    return rows.map((r) => this.toInvite(r));
  }

  async revokeInvite(staff: AuthUser, id: string): Promise<void> {
    if (staff.role !== 'admin') throw new HttpError(403, ErrorCode.Forbidden, 'Admins only.');
    const [row] = await this.db
      .update(inviteCodes)
      .set({ revokedAt: new Date(this.now()) })
      .where(and(eq(inviteCodes.id, id), isNull(inviteCodes.revokedAt)))
      .returning({ id: inviteCodes.id });
    if (!row) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
    await audit(this.db, {
      actorId: staff.id,
      action: 'invite.revoked',
      targetType: 'invite',
      targetId: id,
    });
  }

  /** Personal invites: verified members, in invite mode, when the admins turned them on. */
  async memberInvites(userId: string): Promise<{ allowed: boolean; invites: Invite[] }> {
    const settings = await this.instance.signupSettings();
    const [profile] = await this.db
      .select({ verifiedAt: profiles.verifiedAt })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    const rows = await this.db
      .select()
      .from(inviteCodes)
      .where(and(eq(inviteCodes.createdBy, userId), eq(inviteCodes.byMember, true)))
      .orderBy(desc(inviteCodes.createdAt));
    return {
      allowed:
        settings.mode === 'invite' &&
        settings.memberInvites &&
        Boolean(profile?.verifiedAt) &&
        rows.length < MEMBER_INVITES,
      invites: rows.map((r) => this.toInvite(r)),
    };
  }

  async createMemberInvite(userId: string): Promise<Invite> {
    const { allowed } = await this.memberInvites(userId);
    if (!allowed) {
      throw new HttpError(403, ErrorCode.Forbidden, 'You can’t create more invites.');
    }
    return this.insertInvite({
      createdBy: userId,
      byMember: true,
      label: null,
      maxUses: 1,
      expiresAt: new Date(this.now() + 30 * DAY),
    });
  }

  // -------------------------------------------------------------- waitlist (staff)

  async listWaitlist(status: WaitlistStatus): Promise<WaitlistEntry[]> {
    const rows = await this.db
      .select()
      .from(waitlist)
      .where(eq(waitlist.status, status))
      .orderBy(status === 'pending' ? waitlist.createdAt : desc(waitlist.decidedAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      note: r.note,
      status: r.status as WaitlistStatus,
      createdAt: r.createdAt.toISOString(),
      decidedAt: iso(r.decidedAt),
    }));
  }

  async decideWaitlist(staff: AuthUser, id: string, approve: boolean): Promise<void> {
    const now = new Date(this.now());
    const [entry] = await this.db
      .update(waitlist)
      .set({ status: approve ? 'approved' : 'declined', decidedBy: staff.id, decidedAt: now })
      .where(and(eq(waitlist.id, id), eq(waitlist.status, 'pending')))
      .returning();
    if (!entry) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
    if (approve) {
      const values = {
        emailHash: entry.emailHash,
        inviteId: null,
        expiresAt: new Date(now.getTime() + SIGNUP_ALLOWANCE_DAYS * DAY),
      };
      await this.db
        .insert(signupAllowances)
        .values(values)
        .onConflictDoUpdate({ target: signupAllowances.emailHash, set: values });
      const info = await this.instance.info();
      this.mailer
        .send({
          to: entry.email,
          ...waitlistApprovedEmail(info.name, appUrl(this.env), SIGNUP_ALLOWANCE_DAYS),
        })
        .catch(this.onMailError);
    }
    // The address isn't written to the audit log; the entry id is enough.
    await audit(this.db, {
      actorId: staff.id,
      action: approve ? 'waitlist.approved' : 'waitlist.declined',
      targetType: 'waitlist',
      targetId: id,
    });
  }
}
