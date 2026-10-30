// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Readable } from 'node:stream';
import type { Database } from '@nexaheart/db';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';

/**
 * Phase 66a: whose profile photos this viewer sees blurred. A member's own photos are never
 * blurred for them. Otherwise blurred when:
 * - the owner blurs their photos, unless they showed them in an active match with this viewer;
 * - or the community shows photos only after a match, and the two haven't matched.
 * `viewerId` null is a member of a partner community: there's no match here to show photos in.
 */
export async function blurredOwners(
  db: Database,
  viewerId: string | null,
  ownerIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(ownerIds)].filter((id) => id !== viewerId);
  if (ids.length === 0) return new Set();
  const { rows } = await db.execute<{ id: string }>(sql`
    WITH o AS (SELECT unnest(${sql.param(ids)}::text[]) AS id),
    m AS (
      SELECT o.id, ma.id AS match_id FROM o
      JOIN matches ma ON ma.unmatched_at IS NULL
        AND ((ma.user_a = o.id AND ma.user_b = ${viewerId})
          OR (ma.user_b = o.id AND ma.user_a = ${viewerId}))
    )
    SELECT o.id FROM o
    LEFT JOIN preferences pr ON pr.user_id = o.id
    WHERE (COALESCE(pr.blur_photos, false) AND NOT EXISTS (
            SELECT 1 FROM m JOIN photo_reveals r ON r.match_id = m.match_id AND r.user_id = o.id
            WHERE m.id = o.id))
       OR (COALESCE((SELECT photos_after_match FROM instance_settings WHERE id = 1), false)
            AND NOT EXISTS (SELECT 1 FROM m WHERE m.id = o.id))`);
  return new Set(rows.map((r) => r.id));
}

/**
 * Whether anyone may see this member's photos blurred (they blur, or the community shows photos
 * after a match): responses for such photos are never cached, so taking a reveal back is immediate.
 */
export async function photosMayBlur(db: Database, ownerId: string): Promise<boolean> {
  const { rows } = await db.execute<{ yes: boolean }>(sql`
    SELECT COALESCE((SELECT blur_photos FROM preferences WHERE user_id = ${ownerId}), false)
        OR COALESCE((SELECT photos_after_match FROM instance_settings WHERE id = 1), false) AS yes`);
  return rows[0]?.yes ?? false;
}

/** Width of a blurred photo: too small to recognise anyone; the app scales it up. */
export const BLURRED_WIDTH = 16;

/** A tiny, blurred copy made on the server: the real photo never reaches the viewer. */
export async function blurredCopy(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return sharp(Buffer.concat(chunks))
    .resize({ width: BLURRED_WIDTH, withoutEnlargement: true })
    .blur(1.5)
    .webp({ quality: 40 })
    .toBuffer();
}
