import { schema, type Database } from '@dateos/db';
import { allowedPhotoMimeTypes, ErrorCode, MAX_PHOTOS, type Photo } from '@dateos/shared';
import { mediaKey, quarantineKey, type Storage, type StoredObject } from '@dateos/storage';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { HttpError } from '../../plugins/error-handler.js';
import type { MediaQueue } from '../../lib/queue.js';

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
  ) {}

  async upload(userId: string, buffer: Buffer): Promise<Photo> {
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
        .where(and(eq(photos.userId, userId), ne(photos.status, 'rejected')));
      if (existing.length >= MAX_PHOTOS) {
        throw new HttpError(409, ErrorCode.Conflict, `You can upload up to ${MAX_PHOTOS} photos.`);
      }
      const position = existing.reduce((max, p) => Math.max(max, p.position + 1), 0);
      const [inserted] = await tx
        .insert(photos)
        .values({ userId, position, status: 'quarantine' })
        .returning();
      const key = quarantineKey(userId, inserted!.id);
      await tx.update(photos).set({ quarantineKey: key }).where(eq(photos.id, inserted!.id));
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

  /** Phase 1: only the owner may view a photo. Matching phases widen this rule. */
  async open(viewerId: string, photoId: string): Promise<StoredObject> {
    const [row] = await this.db
      .select({ mediaKey: photos.mediaKey })
      .from(photos)
      .where(and(eq(photos.id, photoId), eq(photos.userId, viewerId), eq(photos.status, 'clean')));
    if (!row?.mediaKey) throw notFound();
    return this.storage.get(this.storage.buckets.media, row.mediaKey);
  }

  async remove(userId: string, photoId: string): Promise<void> {
    const [row] = await this.db
      .delete(photos)
      .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
      .returning({ quarantineKey: photos.quarantineKey, mediaKey: photos.mediaKey });
    if (!row) throw notFound();
    await this.mediaQueue.deleteObjects({
      quarantineKeys: row.quarantineKey ? [row.quarantineKey] : [],
      mediaKeys: row.mediaKey ? [row.mediaKey] : [mediaKey(userId, photoId)],
    });
  }

  /** `photoIds` must list exactly the user's current (non-rejected) photos, in the new order. */
  async reorder(userId: string, photoIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.userId, userId), ne(photos.status, 'rejected')))
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
