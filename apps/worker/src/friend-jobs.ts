// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { UNMATCHED_CHAT_RETENTION_DAYS } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';

/**
 * Runs daily (phase 22): double chats closed more than UNMATCHED_CHAT_RETENTION_DAYS ago lose
 * their messages (like 1:1 chats), and friend links go once used or expired.
 */
export async function processFriendRetention(
  db: Database,
  now = new Date(),
): Promise<{ messages: number; links: number }> {
  const cutoff = new Date(now.getTime() - UNMATCHED_CHAT_RETENTION_DAYS * 86_400_000);
  const messages = await db.execute(sql`
    DELETE FROM double_messages dm USING double_matches d
    WHERE d.id = dm.double_id AND d.closed_at < ${cutoff}`);
  const links = await db.execute(sql`
    DELETE FROM friend_links WHERE used_at IS NOT NULL OR expires_at < ${now}`);
  return { messages: messages.rowCount ?? 0, links: links.rowCount ?? 0 };
}
