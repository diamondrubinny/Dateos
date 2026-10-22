import { createHash, timingSafeEqual } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  deriveBrand,
  ErrorCode,
  type InstanceInfo,
  type InstanceSettingsInput,
  type Locale,
} from '@nexaheart/shared';
import type { StoredObject } from '@nexaheart/storage';
import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { AuthUser } from '../../auth/session.js';
import type { PhotoService } from '../photos/service.js';

const { instanceSettings, photos, user } = schema;

/** Branding changes reach every API instance within this time. */
const CACHE_MS = 15_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export interface AdminInstanceSettings {
  name: string;
  tagline: string;
  primaryColor: string;
  defaultLocale: Locale;
  operatorName: string | null;
  contactEmail: string | null;
  sponsorUrl: string | null;
  logoUrl: string | null;
  setupCompleted: boolean;
}

export class InstanceService {
  private cache: { value: InstanceInfo; at: number } | undefined;

  constructor(
    private readonly db: Database,
    private readonly env: Env,
    private readonly photos: PhotoService,
  ) {}

  private async row() {
    const [row] = await this.db.select().from(instanceSettings).where(eq(instanceSettings.id, 1));
    return row;
  }

  private async logoReady(photoId: string | null | undefined): Promise<boolean> {
    if (!photoId) return false;
    const [photo] = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(and(eq(photos.id, photoId), eq(photos.status, 'clean')));
    return Boolean(photo);
  }

  /** Public branding. Database values override the environment defaults. */
  async info(): Promise<InstanceInfo> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.row();
    const env = this.env;
    const primaryColor = row?.primaryColor ?? env.INSTANCE_PRIMARY_COLOR;
    const noAdmin = await this.db.execute<{ none: boolean }>(
      sql`SELECT NOT EXISTS (SELECT 1 FROM "user" WHERE role = 'admin')
                 AND NOT EXISTS (SELECT 1 FROM instance_claim) AS none`,
    );
    const value: InstanceInfo = {
      name: row?.name ?? env.INSTANCE_NAME,
      tagline: row?.tagline ?? env.INSTANCE_TAGLINE,
      primaryColor,
      locales: env.INSTANCE_LOCALES,
      defaultLocale: row?.defaultLocale ?? env.INSTANCE_DEFAULT_LOCALE,
      auth: {
        magicLink: true,
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        apple: Boolean(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
      },
      sponsorUrl: row ? row.sponsorUrl : (env.SPONSOR_URL ?? null),
      legal: { termsVersion: env.TERMS_VERSION, privacyVersion: env.PRIVACY_VERSION },
      brand: deriveBrand(primaryColor),
      // The id in the URL changes with the logo, so clients can cache it safely.
      logoUrl: (await this.logoReady(row?.logoPhotoId))
        ? `/v1/instance/logo?v=${row!.logoPhotoId!.slice(0, 8)}`
        : null,
      operatorName: row?.operatorName ?? null,
      contactEmail: row?.contactEmail ?? null,
      setupRequired: Boolean(noAdmin.rows[0]?.none),
    };
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  async logo(): Promise<StoredObject> {
    const row = await this.row();
    if (!row?.logoPhotoId) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
    return this.photos.openForStaff(row.logoPhotoId, 'branding');
  }

  async adminSettings(): Promise<AdminInstanceSettings> {
    const info = await this.info();
    const row = await this.row();
    return {
      name: info.name,
      tagline: info.tagline,
      primaryColor: info.primaryColor,
      defaultLocale: info.defaultLocale as Locale,
      operatorName: info.operatorName,
      contactEmail: info.contactEmail,
      sponsorUrl: info.sponsorUrl,
      logoUrl: info.logoUrl,
      setupCompleted: Boolean(row?.setupCompletedAt),
    };
  }

  private requireAdmin(staff: AuthUser) {
    if (staff.role !== 'admin') throw new HttpError(403, ErrorCode.Forbidden, 'Admins only.');
  }

  async update(staff: AuthUser, input: InstanceSettingsInput): Promise<AdminInstanceSettings> {
    this.requireAdmin(staff);
    const values = { ...input, updatedBy: staff.id, updatedAt: new Date() };
    await this.db.transaction(async (tx) => {
      await tx
        .insert(instanceSettings)
        .values({ id: 1, ...values, setupCompletedAt: new Date() })
        .onConflictDoUpdate({
          target: instanceSettings.id,
          set: {
            ...values,
            setupCompletedAt: sql`COALESCE(${instanceSettings.setupCompletedAt}, now())`,
          },
        });
      await audit(tx, {
        actorId: staff.id,
        action: 'instance.updated',
        targetType: 'instance',
        targetId: '1',
        meta: { fields: Object.keys(input).sort().join(',') },
      });
    });
    this.invalidate();
    return this.adminSettings();
  }

  async setLogo(staff: AuthUser, buffer: Buffer): Promise<void> {
    this.requireAdmin(staff);
    // Same quarantine → malware scan → re-encode pipeline as every other image.
    const photo = await this.photos.upload(staff.id, buffer, 'branding');
    const previous = (await this.row())?.logoPhotoId;
    await this.db
      .insert(instanceSettings)
      .values({ id: 1, logoPhotoId: photo.id, updatedBy: staff.id })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { logoPhotoId: photo.id, updatedBy: staff.id, updatedAt: new Date() },
      });
    if (previous) await this.photos.purge(previous);
    await audit(this.db, {
      actorId: staff.id,
      action: 'instance.logo_updated',
      targetType: 'instance',
      targetId: '1',
    });
    this.invalidate();
  }

  async removeLogo(staff: AuthUser): Promise<void> {
    this.requireAdmin(staff);
    const previous = (await this.row())?.logoPhotoId;
    if (!previous) return;
    await this.db
      .update(instanceSettings)
      .set({ logoPhotoId: null })
      .where(eq(instanceSettings.id, 1));
    await this.photos.purge(previous);
    await audit(this.db, {
      actorId: staff.id,
      action: 'instance.logo_removed',
      targetType: 'instance',
      targetId: '1',
    });
    this.invalidate();
  }

  /**
   * First-run claim: whoever holds the setup token from the server's .env becomes the first
   * admin. Only possible while no admin exists.
   */
  async claim(member: AuthUser, token: string): Promise<void> {
    const expected = this.env.SETUP_TOKEN;
    if (!expected) {
      throw new HttpError(
        403,
        ErrorCode.Forbidden,
        'Online setup is disabled. Use the staff command on the server.',
      );
    }
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('instance-setup'))`);
      const taken = await tx.execute<{ taken: boolean }>(
        sql`SELECT EXISTS (SELECT 1 FROM "user" WHERE role = 'admin')
                OR EXISTS (SELECT 1 FROM instance_claim) AS taken`,
      );
      if (taken.rows[0]?.taken) return 'taken' as const;
      // Hashing first makes the comparison constant-time regardless of the input length.
      if (!timingSafeEqual(sha256(token), sha256(expected))) {
        await audit(tx, {
          actorId: member.id,
          action: 'setup.claim_failed',
          targetType: 'instance',
          targetId: '1',
        });
        return 'wrong' as const;
      }
      await tx.update(user).set({ role: 'admin' }).where(eq(user.id, member.id));
      await tx.insert(schema.instanceClaim).values({ id: 1, claimedBy: member.id });
      await audit(tx, {
        actorId: member.id,
        action: 'setup.claimed',
        targetType: 'instance',
        targetId: '1',
      });
      return 'ok' as const;
    });
    this.invalidate();
    if (claimed === 'taken')
      throw new HttpError(410, ErrorCode.Gone, 'This instance has already been set up.');
    if (claimed === 'wrong')
      throw new HttpError(403, ErrorCode.Forbidden, 'The setup token is not valid.');
  }
}
