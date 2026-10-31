// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash, randomBytes } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import { and, eq, gt, isNull } from 'drizzle-orm';

const { friendLinks } = schema;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Single-use links for friends (phase 22): a take or a pair invitation. The token is shown once and
 * stored as a hash; a wrong, used or expired token looks the same to whoever has it.
 */
export async function createLink(
  db: Database,
  ownerId: string,
  kind: 'take' | 'pair' | 'wali',
  days: number,
  now: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now + days * 86_400_000);
  await db.insert(friendLinks).values({ tokenHash: hashToken(token), ownerId, kind, expiresAt });
  return { token, expiresAt: expiresAt.toISOString() };
}

/** The owner of a valid, unused link of this kind, or null. */
export async function linkOwner(
  db: Database,
  token: string,
  kind: 'take' | 'pair' | 'wali',
  now: number,
): Promise<string | null> {
  const [row] = await db
    .select({ ownerId: friendLinks.ownerId })
    .from(friendLinks)
    .where(
      and(
        eq(friendLinks.tokenHash, hashToken(token)),
        eq(friendLinks.kind, kind),
        isNull(friendLinks.usedAt),
        gt(friendLinks.expiresAt, new Date(now)),
      ),
    );
  return row?.ownerId ?? null;
}

/** Marks a link used; false when someone else used it first (one atomic update). */
export async function useLink(
  db: Pick<Database, 'update'>,
  token: string,
  kind: 'take' | 'pair' | 'wali',
  now: number,
): Promise<string | null> {
  const [row] = await db
    .update(friendLinks)
    .set({ usedAt: new Date(now) })
    .where(
      and(
        eq(friendLinks.tokenHash, hashToken(token)),
        eq(friendLinks.kind, kind),
        isNull(friendLinks.usedAt),
        gt(friendLinks.expiresAt, new Date(now)),
      ),
    )
    .returning({ ownerId: friendLinks.ownerId });
  return row?.ownerId ?? null;
}
