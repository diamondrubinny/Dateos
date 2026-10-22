/* eslint-disable no-console -- command-line tool: output is the interface. */
/**
 * Server-side staff management. Roles are never granted over HTTP; an operator with shell
 * access to the server runs:
 *
 *   pnpm --filter @dateos/api staff grant <email> moderator|admin
 *   pnpm --filter @dateos/api staff revoke <email>
 *   pnpm --filter @dateos/api staff reset-mfa <email>
 *   pnpm --filter @dateos/api staff list
 */
import { createDb, schema } from '@dateos/db';
import { eq, inArray } from 'drizzle-orm';
import { audit } from '../lib/audit.js';

const { user, staffMfa, staffSessions } = schema;

export type StaffCommand =
  | { kind: 'grant'; email: string; role: 'moderator' | 'admin' }
  | { kind: 'revoke'; email: string }
  | { kind: 'reset-mfa'; email: string }
  | { kind: 'list' };

export function parseStaffArgs(args: string[]): StaffCommand {
  const [command, email, role] = args;
  if (command === 'list') return { kind: 'list' };
  if (!email || !email.includes('@')) throw new Error('An email address is required.');
  if (command === 'grant') {
    if (role !== 'moderator' && role !== 'admin')
      throw new Error('Role must be moderator or admin.');
    return { kind: 'grant', email, role };
  }
  if (command === 'revoke' || command === 'reset-mfa') return { kind: command, email };
  throw new Error(
    'Usage: staff grant <email> moderator|admin | revoke <email> | reset-mfa <email> | list',
  );
}

async function main() {
  const command = parseStaffArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const { db, pool } = createDb(url);
  try {
    if (command.kind === 'list') {
      const rows = await db
        .select({ email: user.email, role: user.role, mfa: staffMfa.enabledAt })
        .from(user)
        .leftJoin(staffMfa, eq(staffMfa.userId, user.id))
        .where(inArray(user.role, ['moderator', 'admin']));
      for (const r of rows)
        console.log(`${r.role.padEnd(9)} ${r.mfa ? 'mfa' : 'no-mfa'} ${r.email}`);
      return;
    }
    // The member must have signed in once, so the account exists.
    const [target] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, command.email.trim().toLowerCase()));
    if (!target) throw new Error('No account with that email. Ask them to sign in once first.');

    if (command.kind === 'grant') {
      await db.update(user).set({ role: command.role }).where(eq(user.id, target.id));
    } else if (command.kind === 'revoke') {
      await db.update(user).set({ role: 'user' }).where(eq(user.id, target.id));
      await db.delete(staffMfa).where(eq(staffMfa.userId, target.id));
      await db.delete(staffSessions).where(eq(staffSessions.userId, target.id));
    } else {
      await db.delete(staffMfa).where(eq(staffMfa.userId, target.id));
      await db.delete(staffSessions).where(eq(staffSessions.userId, target.id));
    }
    await audit(db, {
      actorId: null,
      action: `staff.cli_${command.kind.replace('-', '_')}`,
      targetType: 'user',
      targetId: target.id,
      ...(command.kind === 'grant' ? { meta: { role: command.role } } : {}),
    });
    console.log('Done.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
