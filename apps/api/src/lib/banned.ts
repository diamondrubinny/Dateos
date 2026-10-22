import { createHmac } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import { eq } from 'drizzle-orm';
import { deriveKey } from './totp.js';

/**
 * Normalises an address so trivial variants map to the same ban: case, surrounding spaces,
 * "+tag" suffixes, and dots in Gmail local parts.
 */
export function normalizeEmail(email: string): string {
  const [rawLocal = '', rawDomain = ''] = email.trim().toLowerCase().split('@');
  let local = rawLocal.split('+')[0]!;
  let domain = rawDomain;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replaceAll('.', '');
  return `${local}@${domain}`;
}

export type EmailHasher = (email: string) => string;

/** Keyed hash: the stored value cannot be reversed or matched against a list of addresses. */
export function createEmailHasher(masterSecret: string): EmailHasher {
  const key = deriveKey(masterSecret, 'banned-email');
  return (email) => createHmac('sha256', key).update(normalizeEmail(email)).digest('hex');
}

export async function isBanned(db: Database, hash: EmailHasher, email: string): Promise<boolean> {
  const [row] = await db
    .select({ h: schema.bannedEmails.emailHash })
    .from(schema.bannedEmails)
    .where(eq(schema.bannedEmails.emailHash, hash(email)));
  return Boolean(row);
}
