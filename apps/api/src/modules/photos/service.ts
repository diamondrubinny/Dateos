// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  allowedPhotoMimeTypes,
  ErrorCode,
  MAX_ALBUM_PHOTOS,
  MAX_PHOTOS,
  type Photo,
} from '@nexaheart/shared';
import { mediaKey, quarantineKey, type Storage, type StoredObject } from '@nexaheart/storage';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { HttpError } from '../../plugins/error-handler.js';
import type { MediaQueue } from '../../lib/queue.js';
import { blurredCopy, blurredOwners, photosMayBlur } from '../../lib/photo-blur.js';
import { mayViewAlbum } from './album.js';

const { photos } = schema;
const allowed = new Set<string>(allowedPhotoMimeTypes);

/** Detects the real type from magic bytes; the client-declared type and extension are ignored. */
export async function sniffImageType(buffer: Buffer): Promise<string | undefined> {
  const detected = await fileTypeFromBuffer(buffer);
  return detected && allowed.has(detected.mime) ? detected.mime : undefined;
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

export class PhotoService {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly mediaQueue: MediaQueue,
    /** Visibility rule shared with discovery; defaults to owner-only. */
    private readonly canView: (viewerId: string, ownerId: string) => Promise<boolean> = async (
      v,
      o,
    ) => v === o,
  ) {}

  async upload(
    userId: string,
    buffer: Buffer,
    purpose: 'profile' | 'chat' | 'verification' | 'branding' | 'album' = 'profile',
  ): Promise<Photo> {
    const mime = await sniffImageType(buffer);
    if (!mime) {
      throw new HttpError(
        415,
        ErrorCode.BadRequest,
        'Only JPEG, PNG and WebP images are accepted.',
      );
    }

    const row = await this.db.transaction(async (tx) => {
      // Serialises uploads per user so parallel requests cannot exceed MAX_PHOTOS.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`photos:${userId}`}))`);
      const existing = await tx
        .select({ position: photos.position })
        .from(photos)
        .where(
          and(
            eq(photos.userId, userId),
            ne(photos.status, 'rejected'),
            eq(photos.purpose, purpose === 'album' ? 'album' : 'profile'),
          ),
        );
      if (purpose === 'profile' && existing.length >= MAX_PHOTOS) {
        throw new HttpError(409, ErrorCode.Conflict, `You can upload up to ${MAX_PHOTOS} photos.`);
      }
      // Phase 66c: a private album has its own limit.
      if (purpose === 'album' && existing.length >= MAX_ALBUM_PHOTOS) {
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          `Your private album holds up to ${MAX_ALBUM_PHOTOS} photos.`,
        );
      }
      const position =
        purpose !== 'profile' ? 0 : existing.reduce((max, p) => Math.max(max, p.position + 1), 0);
      const [inserted] = await tx
        .insert(photos)
        .values({ userId, position, status: 'quarantine', purpose })
        .returning();
      const key = quarantineKey(userId, inserted!.id);
      await tx.update(photos).set({ quarantineKey: key }).where(eq(photos.id, inserted!.id));
      if (purpose === 'profile') {
        await tx
          .update(schema.profiles)
          .set({ verifiedAt: null, photosChangedAt: new Date() })
          .where(eq(schema.profiles.userId, userId));
      }
      return { ...inserted!, quarantineKey: key };
    });

    try {
      await this.storage.put(this.storage.buckets.quarantine, row.quarantineKey, buffer, mime);
      await this.mediaQueue.processPhoto({ photoId: row.id });
    } catch (error) {
      await this.db.delete(photos).where(eq(photos.id, row.id));
      await this.storage
        .delete(this.storage.buckets.quarantine, [row.quarantineKey])
        .catch(() => undefined);
      throw error;
    }

    return {
      id: row.id,
      status: row.status,
      position: row.position,
      url: null,
      width: null,
      height: null,
    };
  }

  /**
   * Owners, and people allowed to see the owner's profile, may view a clean photo. Phase 66a: a
   * profile photo blurred for this viewer is served as a tiny blurred copy; `noStore` when it may
   * be blurred for anyone, so a reveal taken back is never answered from a cache.
   */
  async open(
    viewerId: string,
    photoId: string,
  ): Promise<{ body: StoredObject['body'] | Buffer; noStore: boolean }> {
    const [row] = await this.db
      .select({ mediaKey: photos.mediaKey, userId: photos.userId, purpose: photos.purpose })
      .from(photos)
      .where(and(eq(photos.id, photoId), eq(photos.status, 'clean')));
    if (!row?.mediaKey) throw notFound();
    // Verification selfies are only shown to staff (audited admin API); the logo has its own
    // public route.
    if (row.purpose === 'verification' || row.purpose === 'branding') throw notFound();
    const allowed =
      row.purpose === 'chat'
        ? await this.canViewChatImage(viewerId, photoId)
        : row.purpose === 'album'
          ? // Phase 66c: the owner, or a match within an open share; checked on every request.
            row.userId === viewerId || (await mayViewAlbum(this.db, viewerId, row.userId))
          : await this.canView(viewerId, row.userId);
    if (!allowed) throw notFound();
    const object = await this.storage.get(this.storage.buckets.media, row.mediaKey);
    if (row.purpose === 'album') return { body: object.body, noStore: true };
    if (row.purpose !== 'profile' || row.userId === viewerId) {
      return { body: object.body, noStore: false };
    }
    const noStore = await photosMayBlur(this.db, row.userId);
    if (noStore && (await blurredOwners(this.db, viewerId, [row.userId])).has(row.userId)) {
      return { body: await blurredCopy(object.body), noStore };
    }
    return { body: object.body, noStore };
  }

  /** Staff access (admin API only): any clean photo of a member, regardless of visibility. */
  /**
   * Staff access to one kind of photo: profile photos (moderation), the selfie under review, or the
   * instance logo. Private chat images are never available this way.
   */
  async openForStaff(
    photoId: string,
    purpose: 'profile' | 'verification' | 'branding',
    ownerId?: string,
  ): Promise<StoredObject> {
    const [row] = await this.db
      .select({ mediaKey: photos.mediaKey, userId: photos.userId })
      .from(photos)
      .where(and(eq(photos.id, photoId), eq(photos.status, 'clean'), eq(photos.purpose, purpose)));
    if (!row?.mediaKey || (ownerId && row.userId !== ownerId)) throw notFound();
    return this.storage.get(this.storage.buckets.media, row.mediaKey);
  }

  /** Deletes a photo row and its stored objects (used for decided verification selfies). */
  async purge(photoId: string): Promise<void> {
    const [row] = await this.db.delete(photos).where(eq(photos.id, photoId)).returning({
      userId: photos.userId,
      quarantineKey: photos.quarantineKey,
      mediaKey: photos.mediaKey,
    });
    if (!row) return;
    await this.mediaQueue.deleteObjects({
      quarantineKeys: row.quarantineKey ? [row.quarantineKey] : [],
      mediaKeys: row.mediaKey ? [row.mediaKey] : [mediaKey(row.userId, photoId)],
    });
  }

  /** Chat images are visible only to the two people in an active match where it was sent. */
  private async canViewChatImage(viewerId: string, photoId: string): Promise<boolean> {
    const result = await this.db.execute<{ ok: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM messages m JOIN matches ma ON ma.id = m.match_id
        WHERE m.photo_id = ${photoId} AND ma.unmatched_at IS NULL
          AND (ma.user_a = ${viewerId} OR ma.user_b = ${viewerId})
      ) AS ok`);
    return Boolean(result.rows[0]?.ok);
  }

  async remove(userId: string, photoId: string): Promise<void> {
    const [row] = await this.db
      .delete(photos)
      .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
      .returning({
        quarantineKey: photos.quarantineKey,
        mediaKey: photos.mediaKey,
        purpose: photos.purpose,
      });
    if (!row) throw notFound();
    if (row.purpose === 'profile') await this.profilePhotosChanged(userId);
    await this.mediaQueue.deleteObjects({
      quarantineKeys: row.quarantineKey ? [row.quarantineKey] : [],
      mediaKeys: row.mediaKey ? [row.mediaKey] : [mediaKey(userId, photoId)],
    });
  }

  /**
   * A verified badge vouches for the photos a moderator compared with the selfie. Adding or
   * removing a profile photo removes the badge (the member can verify again).
   */
  private async profilePhotosChanged(userId: string): Promise<void> {
    await this.db
      .update(schema.profiles)
      .set({ verifiedAt: null, photosChangedAt: new Date() })
      .where(eq(schema.profiles.userId, userId));
  }

  /** `photoIds` must list exactly the user's current (non-rejected) photos, in the new order. */
  /**
   * Describe a photo for screen readers (phase 40). Only my own profile photos; empty clears it.
   * Checked like other profile text: harmful wording is refused.
   */
  async describe(userId: string, photoId: string, description: string): Promise<void> {
    const text = description.trim();
    if (text && checkHarm(text).flagged) {
      throw new HttpError(400, ErrorCode.ValidationError, 'Please rephrase the description.');
    }
    const updated = await this.db
      .update(photos)
      .set({ description: text || null })
      .where(
        and(
          eq(photos.id, photoId),
          eq(photos.userId, userId),
          eq(photos.purpose, 'profile'),
          ne(photos.status, 'rejected'),
        ),
      )
      .returning({ id: photos.id });
    if (updated.length === 0) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
  }

  async reorder(userId: string, photoIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: photos.id })
        .from(photos)
        .where(
          and(
            eq(photos.userId, userId),
            ne(photos.status, 'rejected'),
            eq(photos.purpose, 'profile'),
          ),
        )
        .orderBy(asc(photos.position));
      const ownedIds = new Set(owned.map((p) => p.id));
      const requested = new Set(photoIds);
      if (
        requested.size !== photoIds.length ||
        requested.size !== ownedIds.size ||
        photoIds.some((id) => !ownedIds.has(id))
      ) {
        throw new HttpError(
          400,
          ErrorCode.ValidationError,
          'Photo list does not match your photos.',
        );
      }
      for (const [position, id] of photoIds.entries()) {
        await tx
          .update(photos)
          .set({ position })
          .where(and(eq(photos.id, id), eq(photos.userId, userId)));
      }
    });
  }
}
