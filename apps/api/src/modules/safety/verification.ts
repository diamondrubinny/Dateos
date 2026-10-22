// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { randomInt } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  verificationPoses,
  type VerificationReview,
  type VerificationState,
} from '@nexaheart/shared';
import type { StoredObject } from '@nexaheart/storage';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { PhotoService } from '../photos/service.js';

const { verifications, photos, profiles } = schema;

/** Attempts (started verifications) per member per day. */
export const MAX_VERIFICATION_ATTEMPTS_PER_DAY = 3;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

/**
 * Photo verification with a human in the loop: the member takes a selfie copying a random
 * pose, and a moderator compares it with the profile photos. There is no automated face
 * recognition and no biometric template. The selfie is deleted once a decision is made.
 */
export class VerificationService {
  constructor(
    private readonly db: Database,
    private readonly photos: PhotoService,
  ) {}

  private async latest(userId: string) {
    const [row] = await this.db
      .select({
        id: verifications.id,
        pose: verifications.pose,
        status: verifications.status,
        decidedAt: verifications.decidedAt,
        selfiePhotoId: verifications.selfiePhotoId,
        photoStatus: photos.status,
      })
      .from(verifications)
      .leftJoin(photos, eq(photos.id, verifications.selfiePhotoId))
      .where(eq(verifications.userId, userId))
      .orderBy(desc(verifications.createdAt))
      .limit(1);
    return row;
  }

  async state(userId: string): Promise<VerificationState> {
    const row = await this.latest(userId);
    if (!row) return { status: 'none', pose: null, processing: false, decidedAt: null };
    // A selfie that failed scanning means the member needs to take a new one.
    const failed =
      row.status === 'pending' && (!row.selfiePhotoId || row.photoStatus === 'rejected');
    return {
      status: failed ? 'awaiting_selfie' : row.status,
      pose: row.status === 'awaiting_selfie' || failed ? row.pose : null,
      processing: row.status === 'pending' && !failed && row.photoStatus !== 'clean',
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }

  async start(userId: string): Promise<VerificationState> {
    const current = await this.state(userId);
    if (current.status === 'awaiting_selfie') return current;
    if (current.status === 'pending' || current.status === 'approved') {
      throw new HttpError(
        409,
        ErrorCode.Conflict,
        'A verification is already in progress or done.',
      );
    }
    const [photo] = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(
        and(eq(photos.userId, userId), eq(photos.purpose, 'profile'), eq(photos.status, 'clean')),
      )
      .limit(1);
    if (!photo) {
      throw new HttpError(409, ErrorCode.Conflict, 'Add a profile photo before verifying.');
    }
    const [{ attempts } = { attempts: 0 }] = await this.db
      .select({ attempts: sql<number>`count(*)::int` })
      .from(verifications)
      .where(
        and(
          eq(verifications.userId, userId),
          gt(verifications.createdAt, sql`now() - interval '1 day'`),
        ),
      );
    if (attempts >= MAX_VERIFICATION_ATTEMPTS_PER_DAY) {
      throw new HttpError(
        429,
        ErrorCode.RateLimited,
        'Too many attempts today. Try again tomorrow.',
      );
    }
    const pose = verificationPoses[randomInt(verificationPoses.length)]!;
    await this.db.insert(verifications).values({ userId, pose });
    await audit(this.db, {
      actorId: userId,
      action: 'verification.started',
      targetType: 'user',
      targetId: userId,
    });
    return { status: 'awaiting_selfie', pose, processing: false, decidedAt: null };
  }

  async submitSelfie(userId: string, buffer: Buffer): Promise<VerificationState> {
    const row = await this.latest(userId);
    const retry =
      row?.status === 'pending' && (!row.selfiePhotoId || row.photoStatus === 'rejected');
    if (!row || (row.status !== 'awaiting_selfie' && !retry)) {
      throw new HttpError(409, ErrorCode.Conflict, 'Start a verification first.');
    }
    // Goes through the same quarantine → malware scan → re-encode pipeline as every upload.
    const photo = await this.photos.upload(userId, buffer, 'verification');
    // Only the request that still sees the selfie it started from wins; a parallel upload that
    // lost is deleted, so no selfie is ever left behind.
    const won = await this.db
      .update(verifications)
      .set({ status: 'pending', selfiePhotoId: photo.id })
      .where(
        and(
          eq(verifications.id, row.id),
          row.selfiePhotoId
            ? eq(verifications.selfiePhotoId, row.selfiePhotoId)
            : isNull(verifications.selfiePhotoId),
        ),
      )
      .returning({ id: verifications.id });
    if (won.length === 0) {
      await this.photos.purge(photo.id);
      throw new HttpError(409, ErrorCode.Conflict, 'A selfie is already being processed.');
    }
    if (row.selfiePhotoId) await this.photos.purge(row.selfiePhotoId);
    return { status: 'pending', pose: null, processing: true, decidedAt: null };
  }

  // ------------------------------------------------------------------ staff

  async queue(): Promise<VerificationReview[]> {
    const rows = await this.db
      .select({
        id: verifications.id,
        userId: verifications.userId,
        pose: verifications.pose,
        createdAt: verifications.createdAt,
        displayName: profiles.displayName,
      })
      .from(verifications)
      .innerJoin(
        photos,
        and(eq(photos.id, verifications.selfiePhotoId), eq(photos.status, 'clean')),
      )
      .leftJoin(profiles, eq(profiles.userId, verifications.userId))
      .where(eq(verifications.status, 'pending'))
      .orderBy(asc(verifications.createdAt))
      .limit(100);
    const result: VerificationReview[] = [];
    for (const r of rows) {
      const profilePhotos = await this.db
        .select({ id: photos.id })
        .from(photos)
        .where(
          and(
            eq(photos.userId, r.userId),
            eq(photos.purpose, 'profile'),
            eq(photos.status, 'clean'),
          ),
        )
        .orderBy(asc(photos.position));
      result.push({
        id: r.id,
        userId: r.userId,
        displayName: r.displayName,
        pose: r.pose,
        createdAt: r.createdAt.toISOString(),
        profilePhotoIds: profilePhotos.map((p) => p.id),
      });
    }
    return result;
  }

  async selfie(staffId: string, verificationId: string): Promise<StoredObject> {
    const [row] = await this.db
      .select({ userId: verifications.userId, photoId: verifications.selfiePhotoId })
      .from(verifications)
      .where(and(eq(verifications.id, verificationId), eq(verifications.status, 'pending')));
    if (!row?.photoId) throw notFound();
    await audit(this.db, {
      actorId: staffId,
      action: 'staff.selfie_viewed',
      targetType: 'verification',
      targetId: verificationId,
    });
    return this.photos.openForStaff(row.photoId, 'verification', row.userId);
  }

  async decide(staffId: string, verificationId: string, approve: boolean): Promise<void> {
    const [row] = await this.db
      .select({ userId: verifications.userId, photoId: verifications.selfiePhotoId })
      .from(verifications)
      .where(and(eq(verifications.id, verificationId), eq(verifications.status, 'pending')));
    if (!row) throw notFound();
    if (row.userId === staffId) {
      throw new HttpError(403, ErrorCode.Forbidden, 'You cannot review your own verification.');
    }
    if (approve) {
      // The selfie must be compared with the photos the profile shows now.
      const [stale] = await this.db
        .select({ id: verifications.id })
        .from(verifications)
        .innerJoin(profiles, eq(profiles.userId, verifications.userId))
        .innerJoin(photos, eq(photos.id, verifications.selfiePhotoId))
        .where(
          and(
            eq(verifications.id, verificationId),
            sql`${profiles.photosChangedAt} > ${photos.createdAt}`,
          ),
        );
      if (stale) {
        await this.db
          .update(verifications)
          .set({ status: 'awaiting_selfie', selfiePhotoId: null })
          .where(eq(verifications.id, verificationId));
        if (row.photoId) await this.photos.purge(row.photoId);
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          'The member changed their photos after taking the selfie; they have been asked for a new one.',
        );
      }
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(verifications)
        .set({
          status: approve ? 'approved' : 'rejected',
          decidedBy: staffId,
          decidedAt: new Date(),
        })
        .where(eq(verifications.id, verificationId));
      if (approve) {
        await tx
          .update(profiles)
          .set({ verifiedAt: new Date() })
          .where(eq(profiles.userId, row.userId));
      }
      await audit(tx, {
        actorId: staffId,
        action: approve ? 'verification.approved' : 'verification.rejected',
        targetType: 'user',
        targetId: row.userId,
      });
    });
    // The selfie is no longer needed once a decision exists.
    if (row.photoId) await this.photos.purge(row.photoId);
  }
}
