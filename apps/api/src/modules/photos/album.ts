// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  ALBUM_WINDOW_SECONDS,
  ErrorCode,
  type AlbumShareMode,
  type AlbumShareState,
  type MyAlbum,
  type SharedAlbum,
} from '@nexaheart/shared';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import { photoUrl } from '../me/service.js';
import type { PhotoService } from './service.js';

const { photos, albumShares } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

type ShareRow = {
  mode: AlbumShareMode;
  opened_at: Date | null;
  expires_at: Date | null;
  open: boolean;
};

/** Whether the other person may open it now: not looked at yet, or within its window. */
const OPEN_SQL = sql`(s.mode = 'unlimited' OR s.opened_at IS NULL OR s.expires_at > now())`;

function toState(row: ShareRow | undefined): AlbumShareState | null {
  return row
    ? {
        mode: row.mode,
        openedAt: row.opened_at ? new Date(row.opened_at).toISOString() : null,
        open: row.open,
      }
    : null;
}

/**
 * Phase 66c: a member's private album (up to 6 photos, never on the profile), shared with one
 * match at a time: once (a minute from the first look), ten minutes from the first look, or without
 * a limit. Every photo request checks the window on the server.
 */
export class AlbumService {
  constructor(
    private readonly db: Database,
    private readonly photos: PhotoService,
  ) {}

  async mine(userId: string): Promise<MyAlbum> {
    const rows = await this.db
      .select({ id: photos.id, status: photos.status })
      .from(photos)
      .where(
        and(eq(photos.userId, userId), eq(photos.purpose, 'album'), ne(photos.status, 'rejected')),
      )
      .orderBy(asc(photos.createdAt));
    return {
      photos: rows.map((r) => ({
        id: r.id,
        status: r.status,
        url: r.status === 'clean' ? photoUrl(r.id) : null,
      })),
    };
  }

  async upload(userId: string, buffer: Buffer) {
    return this.photos.upload(userId, buffer, 'album');
  }

  /** The other person in an open match of mine, or 404. */
  private async otherIn(matchId: string, userId: string): Promise<string> {
    const { rows } = await this.db.execute<{ other: string }>(sql`
      SELECT CASE WHEN user_a = ${userId} THEN user_b ELSE user_a END AS other
      FROM matches WHERE id = ${matchId} AND unmatched_at IS NULL
        AND (user_a = ${userId} OR user_b = ${userId})`);
    if (!rows[0]) throw notFound();
    return rows[0].other;
  }

  /** Share (or share again: the window starts over at the next look). */
  async share(matchId: string, userId: string, mode: AlbumShareMode): Promise<void> {
    await this.otherIn(matchId, userId);
    const [ready] = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(
        and(eq(photos.userId, userId), eq(photos.purpose, 'album'), eq(photos.status, 'clean')),
      )
      .limit(1);
    if (!ready) {
      throw new HttpError(409, ErrorCode.Conflict, 'Add a photo to your private album first.');
    }
    const values = { mode, openedAt: null, expiresAt: null, createdAt: new Date() };
    await this.db
      .insert(albumShares)
      .values({ matchId, userId, ...values })
      .onConflictDoUpdate({ target: [albumShares.matchId, albumShares.userId], set: values });
  }

  async unshare(matchId: string, userId: string): Promise<void> {
    await this.otherIn(matchId, userId);
    await this.db
      .delete(albumShares)
      .where(and(eq(albumShares.matchId, matchId), eq(albumShares.userId, userId)));
  }

  private async shareRow(matchId: string, ownerId: string): Promise<ShareRow | undefined> {
    const { rows } = await this.db.execute<ShareRow>(sql`
      SELECT s.mode, s.opened_at, s.expires_at, ${OPEN_SQL} AS open
      FROM album_shares s WHERE s.match_id = ${matchId} AND s.user_id = ${ownerId}`);
    return rows[0];
  }

  /** For the chat: my album here (null without photos) and the other person's share with me. */
  async chatState(
    matchId: string,
    viewerId: string,
    otherId: string,
  ): Promise<{
    myAlbum: { share: AlbumShareState | null } | null;
    theirAlbum: AlbumShareState | null;
  }> {
    const [{ n }] = (
      await this.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM photos
        WHERE user_id = ${viewerId} AND purpose = 'album' AND status = 'clean'`)
    ).rows as [{ n: number }];
    return {
      myAlbum: n > 0 ? { share: toState(await this.shareRow(matchId, viewerId)) } : null,
      theirAlbum: toState(await this.shareRow(matchId, otherId)),
    };
  }

  /** The other person's album: the first look starts the window. */
  async theirs(matchId: string, viewerId: string): Promise<SharedAlbum> {
    const ownerId = await this.otherIn(matchId, viewerId);
    const row = await this.shareRow(matchId, ownerId);
    if (!row) return { share: null, photos: [], expiresAt: null };
    if (!row.opened_at && row.open) {
      const window = ALBUM_WINDOW_SECONDS[row.mode];
      await this.db.execute(sql`
        UPDATE album_shares SET opened_at = now(),
          expires_at = ${window === null ? sql`NULL` : sql`now() + make_interval(secs => ${window})`}
        WHERE match_id = ${matchId} AND user_id = ${ownerId} AND opened_at IS NULL`);
    }
    const opened = (await this.shareRow(matchId, ownerId))!;
    const list = opened.open
      ? await this.db
          .select({ id: photos.id })
          .from(photos)
          .where(
            and(
              eq(photos.userId, ownerId),
              eq(photos.purpose, 'album'),
              eq(photos.status, 'clean'),
            ),
          )
          .orderBy(asc(photos.createdAt))
      : [];
    return {
      share: toState(opened),
      photos: list.map((p) => ({ id: p.id, url: photoUrl(p.id) })),
      expiresAt:
        opened.open && opened.expires_at ? new Date(opened.expires_at).toISOString() : null,
    };
  }
}

/**
 * May this viewer get one of the owner's album photos now? Only through a share in an open match
 * between them, already opened, within its window.
 */
export async function mayViewAlbum(
  db: Database,
  viewerId: string,
  ownerId: string,
): Promise<boolean> {
  const { rows } = await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM album_shares s JOIN matches m ON m.id = s.match_id
      WHERE s.user_id = ${ownerId} AND m.unmatched_at IS NULL
        AND ((m.user_a = ${ownerId} AND m.user_b = ${viewerId})
          OR (m.user_b = ${ownerId} AND m.user_a = ${viewerId}))
        AND s.opened_at IS NOT NULL
        AND (s.mode = 'unlimited' OR s.expires_at > now())
    ) AS ok`);
  return rows[0]?.ok ?? false;
}
