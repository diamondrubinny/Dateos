// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHmac } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import { normalizeEmail } from '@nexaheart/shared';
import { eq } from 'drizzle-orm';
import { deriveKey } from './totp.js';

// One normalisation for bans, sign-up permissions and contact matching (shared with the app).
export { normalizeEmail };

export type EmailHasher = (email: string) => string;

/** Keyed hash: the stored value cannot be reversed or matched against a list of addresses. */
export function createEmailHasher(masterSecret: string, purpose = 'banned-email'): EmailHasher {
  const key = deriveKey(masterSecret, purpose);
  return (email) => createHmac('sha256', key).update(normalizeEmail(email)).digest('hex');
}

export async function isBanned(db: Database, hash: EmailHasher, email: string): Promise<boolean> {
  const [row] = await db
    .select({ h: schema.bannedEmails.emailHash })
    .from(schema.bannedEmails)
    .where(eq(schema.bannedEmails.emailHash, hash(email)));
  return Boolean(row);
}
