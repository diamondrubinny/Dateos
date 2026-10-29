// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash, randomBytes } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import { EMAIL_CHANGE_MINUTES, ErrorCode, normalizeEmail } from '@nexaheart/shared';
import { and, eq, gt, lte, ne, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { isBanned, type EmailHasher } from '../../lib/banned.js';
import { emailChangeConfirmEmail, emailChangeNoticeEmail, type Mailer } from '../../lib/mailer.js';
import { HttpError } from '../../plugins/error-handler.js';

const { emailChanges, session, user } = schema;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** The same answer whatever happened, so the form can't tell whether an address has an account. */
const notUsable = () =>
  new HttpError(409, ErrorCode.Conflict, 'This address can’t be used. Try another one.');

/**
 * Changing the account's email (phase 41). The new address proves itself with a one-time link
 * opened in the same account; the old address is told, without a link.
 */
export class EmailChangeService {
  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly hashEmail: EmailHasher,
    private readonly options: {
      instanceName: string;
      appUrl: string;
      onMailError: (err: unknown) => void;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Free for this account: no other account has it, and it isn't banned. */
  private async usable(userId: string, email: string): Promise<boolean> {
    const [taken] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(and(sql`lower(${user.email}) = ${email}`, ne(user.id, userId)));
    return !taken && !(await isBanned(this.db, this.hashEmail, email));
  }

  /**
   * Always answers the same. The current address always gets the heads-up; the link goes out only
   * when the new address can be used.
   */
  async request(userId: string, rawEmail: string): Promise<void> {
    await this.purgeExpired();
    const email = normalizeEmail(rawEmail);
    const [me] = await this.db.select({ email: user.email }).from(user).where(eq(user.id, userId));
    if (!me || normalizeEmail(me.email) === email) return;
    const { instanceName, onMailError } = this.options;
    // Whatever happens next, the current mailbox hears that someone in the account tried.
    this.mailer.send({ to: me.email, ...emailChangeNoticeEmail(instanceName) }).catch(onMailError);
    if (!(await this.usable(userId, email))) return;

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now() + EMAIL_CHANGE_MINUTES * 60_000);
    // A newer request replaces an older one.
    await this.db
      .insert(emailChanges)
      .values({ userId, newEmail: email, tokenHash: sha256(token), expiresAt })
      .onConflictDoUpdate({
        target: emailChanges.userId,
        set: { newEmail: email, tokenHash: sha256(token), expiresAt, createdAt: new Date() },
      });
    await audit(this.db, {
      actorId: userId,
      action: 'email.change_requested',
      targetType: 'user',
      targetId: userId,
    });
    const url = `${this.options.appUrl}/confirm-email?token=${token}`;
    this.mailer
      .send({ to: email, ...emailChangeConfirmEmail(instanceName, url, EMAIL_CHANGE_MINUTES) })
      .catch(onMailError);
  }

  /** In the same account only; checked again, then every other device is signed out. */
  async confirm(userId: string, sessionId: string, token: string): Promise<{ email: string }> {
    return this.db.transaction(async (tx) => {
      const [pending] = await tx
        .delete(emailChanges)
        .where(
          and(
            eq(emailChanges.tokenHash, sha256(token)),
            eq(emailChanges.userId, userId),
            gt(emailChanges.expiresAt, new Date(this.now())),
          ),
        )
        .returning({ newEmail: emailChanges.newEmail });
      if (!pending) {
        throw new HttpError(404, ErrorCode.NotFound, 'This link has expired or was already used.');
      }
      if (!(await this.usable(userId, pending.newEmail))) throw notUsable();
      await tx
        .update(user)
        .set({ email: pending.newEmail, emailVerified: true, updatedAt: new Date() })
        .where(eq(user.id, userId));
      const others = await tx
        .delete(session)
        .where(and(eq(session.userId, userId), ne(session.id, sessionId)))
        .returning({ id: session.id });
      // The addresses themselves are never written to the audit log.
      await audit(tx, {
        actorId: userId,
        action: 'email.changed',
        targetType: 'user',
        targetId: userId,
        meta: { signedOut: others.length },
      });
      return { email: pending.newEmail };
    });
  }

  /** Expired requests (run with every new request). */
  async purgeExpired(): Promise<number> {
    const removed = await this.db
      .delete(emailChanges)
      .where(lte(emailChanges.expiresAt, new Date(this.now())))
      .returning({ userId: emailChanges.userId });
    return removed.length;
  }
}
