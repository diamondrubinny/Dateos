// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash, timingSafeEqual } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  type BrandIconName,
  DEFAULT_CALL_MAX_MINUTES,
  deriveBrand,
  ErrorCode,
  type InstanceInfo,
  type InstanceSettingsInput,
  type Locale,
  type SignupMode,
  type IdentityVocabulary,
  type Intention,
  intentions,
  MIN_AGE,
  type Gender,
  type IntroductionOrder,
} from '@nexaheart/shared';
import type { StoredObject } from '@nexaheart/storage';
import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import type { AuthUser } from '../../auth/session.js';
import type { PhotoService } from '../photos/service.js';
import { liveKitConfigured } from '../../lib/livekit.js';
import { brandIcon, plainIcon } from './brand-icons.js';
import { poweredBy } from '../../lib/credit.js';

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
  /** Video dates: whether LiveKit is configured on the server, and the admins' choices. */
  callsConfigured: boolean;
  callsEnabled: boolean;
  callMaxMinutes: number;
  signupMode: SignupMode;
  memberInvites: boolean;
  identityVocabulary: IdentityVocabulary;
  identityCustom: boolean;
  identityPronouns: boolean;
  intentionsOffered: Intention[];
  faithModule: boolean;
  photosAfterMatch: boolean;
  safetyResources: string | null;
  discreetName: string | null;
  riskCountries: string[];
  introductionOrder: IntroductionOrder;
  joinMinAge: number;
  joinMaxAge: number | null;
  joinGenders: Gender[];
  joinDeclaration: string | null;
  /** Phase 63: whether a provider is configured on the server, and the admins' choice. */
  ageCheckConfigured: boolean;
  ageCheckRequired: boolean;
}

export class InstanceService {
  private cache: { value: Omit<InstanceInfo, 'integrations'>; at: number } | undefined;

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
  async info(): Promise<Omit<InstanceInfo, 'integrations'>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.row();
    const env = this.env;
    const primaryColor = row?.primaryColor ?? env.INSTANCE_PRIMARY_COLOR;
    const noAdmin = await this.db.execute<{ none: boolean }>(
      sql`SELECT NOT EXISTS (SELECT 1 FROM "user" WHERE role = 'admin')
                 AND NOT EXISTS (SELECT 1 FROM instance_claim) AS none`,
    );
    const value: Omit<InstanceInfo, 'integrations'> = {
      name: row?.name ?? env.INSTANCE_NAME,
      tagline: row?.tagline ?? env.INSTANCE_TAGLINE,
      primaryColor,
      locales: env.INSTANCE_LOCALES,
      defaultLocale: row?.defaultLocale ?? env.INSTANCE_DEFAULT_LOCALE,
      auth: {
        magicLink: true,
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        apple: Boolean(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
        passkey: true,
      },
      sponsorUrl: row ? row.sponsorUrl : (env.SPONSOR_URL ?? null),
      legal: { termsVersion: env.TERMS_VERSION, privacyVersion: env.PRIVACY_VERSION },
      brand: deriveBrand(primaryColor),
      // The id in the URL changes with the logo, so clients can cache it safely.
      discreetName: row?.discreetName ?? null,
      logoUrl: (await this.logoReady(row?.logoPhotoId))
        ? `/v1/instance/logo?v=${row!.logoPhotoId!.slice(0, 8)}`
        : null,
      operatorName: row?.operatorName ?? null,
      contactEmail: row?.contactEmail ?? null,
      setupRequired: Boolean(noAdmin.rows[0]?.none),
      calls: liveKitConfigured(env) && Boolean(row?.callsEnabled),
      transcripts: env.TRANSCRIPTS === 'local',
      signup: (row?.signupMode ?? 'open') as SignupMode,
      identity: {
        vocabulary: row?.identityVocabulary === 'basic' ? 'basic' : 'extended',
        customGender: row?.identityCustom ?? false,
        pronouns: row?.identityPronouns ?? true,
      },
      // Phase 62b: intentions offered (all unless narrowed) and the faith module.
      community: {
        ageCheck: ageCheckConfigured(env) && (row?.ageCheckRequired ?? false),
        intentions: offeredIntentions(row?.intentionsOffered),
        faith: row?.faithModule ?? false,
        photosAfterMatch: row?.photosAfterMatch ?? false,
        safetyResources: row?.safetyResources ?? null,
        riskCountries: row?.riskCountries ?? [],
        join: {
          minAge: Math.max(MIN_AGE, row?.joinMinAge ?? MIN_AGE),
          maxAge: row?.joinMaxAge ?? null,
          genders: (row?.joinGenders ?? []) as Gender[],
          declaration: row?.joinDeclaration ?? null,
        },
      },
      poweredBy: poweredBy(env),
    };
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  /** Phase 59: icons made from the logo, per logo version (a new logo is a new version). */
  private icons = new Map<string, Buffer>();

  /**
   * The home-screen icon `name` made from the community's logo, or null when there's no logo yet
   * (the route then sends the built-in icon).
   */
  async brandIcon(name: BrandIconName): Promise<Buffer | null> {
    const row = await this.row();
    // Phase 67b: a discreet app gets plain icons, never the logo (or the built-in heart).
    if (row?.discreetName) {
      const key = `discreet:${name}`;
      const cached = this.icons.get(key) ?? (await plainIcon(name));
      this.icons.set(key, cached);
      return cached;
    }
    if (!row?.logoPhotoId || !(await this.logoReady(row.logoPhotoId))) return null;
    const key = `${row.logoPhotoId}:${name}`;
    const cached = this.icons.get(key);
    if (cached) return cached;
    const object = await this.photos.openForStaff(row.logoPhotoId, 'branding');
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
    const icon = await brandIcon(Buffer.concat(chunks), name);
    // Only the current logo's icons are kept.
    for (const k of this.icons.keys())
      if (!k.startsWith(`${row.logoPhotoId}:`)) this.icons.delete(k);
    this.icons.set(key, icon);
    return icon;
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
      callsConfigured: liveKitConfigured(this.env),
      callsEnabled: row?.callsEnabled ?? false,
      callMaxMinutes: row?.callMaxMinutes ?? DEFAULT_CALL_MAX_MINUTES,
      signupMode: (row?.signupMode ?? 'open') as SignupMode,
      memberInvites: row?.memberInvites ?? false,
      identityVocabulary: info.identity.vocabulary,
      identityCustom: info.identity.customGender,
      identityPronouns: info.identity.pronouns,
      intentionsOffered: info.community.intentions,
      faithModule: info.community.faith,
      photosAfterMatch: info.community.photosAfterMatch,
      safetyResources: info.community.safetyResources,
      discreetName: info.discreetName,
      riskCountries: info.community.riskCountries,
      introductionOrder: row?.introductionOrder === 'women_first' ? 'women_first' : 'together',
      joinMinAge: info.community.join.minAge,
      joinMaxAge: info.community.join.maxAge,
      joinGenders: info.community.join.genders,
      joinDeclaration: info.community.join.declaration,
      ageCheckConfigured: ageCheckConfigured(this.env),
      ageCheckRequired: row?.ageCheckRequired ?? false,
    };
  }

  /** Read fresh (not cached): who may sign up is checked on every new account. */
  /** Phase 68a: who hears about an introduction first (read fresh). */
  async introductionOrder(): Promise<IntroductionOrder> {
    const row = await this.row();
    return row?.introductionOrder === 'women_first' ? 'women_first' : 'together';
  }

  async signupSettings(): Promise<{ mode: SignupMode; memberInvites: boolean }> {
    const row = await this.row();
    return {
      mode: (row?.signupMode ?? 'open') as SignupMode,
      memberInvites: row?.memberInvites ?? false,
    };
  }

  /** Read fresh (not cached): turning calls off must take effect at once. */
  async callSettings(): Promise<{ enabled: boolean; maxMinutes: number }> {
    const row = await this.row();
    return {
      enabled: liveKitConfigured(this.env) && Boolean(row?.callsEnabled),
      maxMinutes: row?.callMaxMinutes ?? DEFAULT_CALL_MAX_MINUTES,
    };
  }

  private requireAdmin(staff: AuthUser) {
    if (staff.role !== 'admin') throw new HttpError(403, ErrorCode.Forbidden, 'Admins only.');
  }

  async update(staff: AuthUser, input: InstanceSettingsInput): Promise<AdminInstanceSettings> {
    this.requireAdmin(staff);
    // Phase 62c: the maximum age, if any, can't be below the minimum (as they'd be after saving).
    if (input.joinMinAge !== undefined || input.joinMaxAge !== undefined) {
      const row = await this.row();
      const min = input.joinMinAge ?? row?.joinMinAge ?? MIN_AGE;
      const max = input.joinMaxAge === undefined ? (row?.joinMaxAge ?? null) : input.joinMaxAge;
      if (max !== null && max < min) {
        throw new HttpError(
          400,
          ErrorCode.ValidationError,
          'The maximum age is below the minimum.',
        );
      }
    }
    if (input.ageCheckRequired === true && !ageCheckConfigured(this.env)) {
      throw new HttpError(
        400,
        ErrorCode.ValidationError,
        'Set up an age-check provider on the server first (AGE_CHECK_URL and AGE_CHECK_SECRET).',
      );
    }
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

/** Phase 62b: the stored list, or all intentions when none was chosen. */
function offeredIntentions(stored: string[] | null | undefined): Intention[] {
  const list = (stored ?? []).filter((i): i is Intention =>
    (intentions as readonly string[]).includes(i),
  );
  return list.length > 0 ? list : [...intentions];
}

/** Phase 63: an age-check provider is configured on this server. */
function ageCheckConfigured(env: Env): boolean {
  return Boolean(env.AGE_CHECK_URL && env.AGE_CHECK_SECRET);
}
