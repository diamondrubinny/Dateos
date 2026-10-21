import { schema, type Database } from '@dateos/db';
import {
  ageOn,
  ErrorCode,
  MIN_AGE,
  MIN_PHOTOS,
  requiredConsents,
  type ConsentInput,
  type MeResponse,
  type OnboardingStep,
  type Preferences,
  type ProfileInput,
  type ProfileUpdate,
  type PromptAnswer,
} from '@dateos/shared';
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import type { MediaQueue, ProfileQueue } from '../../lib/queue.js';
import { audit } from '../../lib/audit.js';

const {
  profiles,
  preferences,
  prompts,
  photos,
  consents,
  user,
  session,
  locations,
  moderationLog,
} = schema;

export interface LegalVersions {
  termsVersion: string;
  privacyVersion: string;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function photoUrl(photoId: string): string {
  return `/v1/photos/${photoId}`;
}

export class MeService {
  constructor(
    private readonly db: Database,
    private readonly mediaQueue: MediaQueue,
    private readonly legal: LegalVersions,
    private readonly today: () => string = todayUtc,
    private readonly profileQueue?: ProfileQueue,
  ) {}

  async getMe(userId: string): Promise<MeResponse> {
    const [account] = await this.db
      .select({ id: user.id, email: user.email, status: user.status })
      .from(user)
      .where(eq(user.id, userId));
    if (!account) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

    const [profile] = await this.db.select().from(profiles).where(eq(profiles.userId, userId));
    const [prefs] = await this.db.select().from(preferences).where(eq(preferences.userId, userId));
    const promptRows = await this.db
      .select({ promptKey: prompts.promptKey, answer: prompts.answer })
      .from(prompts)
      .where(eq(prompts.userId, userId))
      .orderBy(asc(prompts.position));
    const photoRows = await this.db
      .select()
      .from(photos)
      .where(
        and(
          eq(photos.userId, userId),
          ne(photos.status, 'rejected'),
          eq(photos.purpose, 'profile'),
        ),
      )
      .orderBy(asc(photos.position), asc(photos.createdAt));
    const consentState = await this.currentConsents(userId);

    const missing: OnboardingStep[] = [];
    if (!profile) missing.push('profile');
    if (!this.hasRequiredConsents(consentState)) missing.push('consents');
    if (photoRows.length < MIN_PHOTOS) missing.push('photos');
    if (promptRows.length === 0) missing.push('prompts');
    const [location] = await this.db
      .select({ userId: locations.userId })
      .from(locations)
      .where(eq(locations.userId, userId));
    if (!location) missing.push('location');
    const warnings = await this.db
      .select({
        id: moderationLog.id,
        category: moderationLog.category,
        createdAt: moderationLog.createdAt,
      })
      .from(moderationLog)
      .where(
        and(
          eq(moderationLog.targetId, userId),
          eq(moderationLog.action, 'warn'),
          isNull(moderationLog.acknowledgedAt),
        ),
      )
      .orderBy(asc(moderationLog.createdAt));

    return {
      user: account,
      profile: profile
        ? {
            displayName: profile.displayName,
            birthDate: profile.birthDate,
            gender: profile.gender,
            interestedIn: profile.interestedIn,
            intention: profile.intention,
            bio: profile.bio,
            languages: profile.languages,
            age: ageOn(profile.birthDate, this.today()),
          }
        : null,
      preferences: prefs
        ? {
            ageMin: prefs.ageMin,
            ageMax: prefs.ageMax,
            maxDistanceKm: prefs.maxDistanceKm,
            intentions: prefs.intentions,
          }
        : null,
      prompts: promptRows,
      photos: photoRows.map((p) => ({
        id: p.id,
        status: p.status,
        position: p.position,
        url: p.status === 'clean' ? photoUrl(p.id) : null,
        width: p.width,
        height: p.height,
      })),
      consents: Object.fromEntries(
        Object.entries(consentState).map(([kind, c]) => [kind, c.granted]),
      ),
      onboarding: { complete: missing.length === 0, missing },
      verified: Boolean(profile?.verifiedAt),
      // Members see the category of a warning, never the moderator's internal note.
      notices: warnings.map((w) => ({
        id: w.id,
        kind: 'warning' as const,
        category: w.category ?? 'other',
        createdAt: w.createdAt.toISOString(),
      })),
    };
  }

  /** Creates the profile. Birth date is final: an underage date suspends the account. */
  async createProfile(userId: string, input: ProfileInput): Promise<void> {
    const [existing] = await this.db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    if (existing) throw new HttpError(409, ErrorCode.Conflict, 'Profile already exists.');

    const age = ageOn(input.birthDate, this.today());
    if (age < MIN_AGE) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(user)
          .set({ status: 'suspended', suspendedReason: 'underage' })
          .where(eq(user.id, userId));
        await tx.delete(session).where(eq(session.userId, userId));
        await audit(tx, {
          actorId: userId,
          action: 'account.suspended_underage',
          targetType: 'user',
          targetId: userId,
        });
      });
      throw new HttpError(
        403,
        ErrorCode.Underage,
        `You must be at least ${MIN_AGE} to use this service.`,
      );
    }

    await this.db.transaction(async (tx) => {
      await tx.insert(profiles).values({
        userId,
        displayName: input.displayName,
        birthDate: input.birthDate,
        gender: input.gender,
        interestedIn: input.interestedIn,
        intention: input.intention,
        bio: input.bio ?? null,
        languages: input.languages,
      });
      await tx
        .insert(preferences)
        .values({
          userId,
          ageMin: Math.max(MIN_AGE, age - 5),
          ageMax: Math.min(100, age + 5),
          maxDistanceKm: 50,
          intentions: [],
        })
        .onConflictDoNothing();
      await tx.update(user).set({ name: input.displayName }).where(eq(user.id, userId));
    });
    await this.profileQueue?.embedProfile(userId);
  }

  async updateProfile(userId: string, input: ProfileUpdate): Promise<void> {
    const values = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as ProfileUpdate;
    if (Object.keys(values).length === 0) return;
    const updated = await this.db
      .update(profiles)
      .set({ ...values, ...(values.bio !== undefined ? { bio: values.bio || null } : {}) })
      .where(eq(profiles.userId, userId))
      .returning({ userId: profiles.userId });
    if (updated.length === 0)
      throw new HttpError(404, ErrorCode.NotFound, 'Create your profile first.');
    if (values.displayName) {
      await this.db.update(user).set({ name: values.displayName }).where(eq(user.id, userId));
    }
    if (values.bio !== undefined || values.intention !== undefined) {
      await this.profileQueue?.embedProfile(userId);
    }
  }

  async setPreferences(userId: string, input: Preferences): Promise<void> {
    await this.db
      .insert(preferences)
      .values({ userId, ...input })
      .onConflictDoUpdate({ target: preferences.userId, set: { ...input } });
  }

  async setPrompts(userId: string, items: PromptAnswer[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(prompts).where(eq(prompts.userId, userId));
      if (items.length > 0) {
        await tx
          .insert(prompts)
          .values(items.map((item, position) => ({ userId, position, ...item })));
      }
    });
    await this.profileQueue?.embedProfile(userId);
  }

  async recordConsents(userId: string, items: ConsentInput[]): Promise<void> {
    const expected: Partial<Record<string, string>> = {
      terms: this.legal.termsVersion,
      privacy: this.legal.privacyVersion,
    };
    for (const item of items) {
      const version = expected[item.kind];
      if (item.granted && version && item.version !== version) {
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          'A newer version of this document is available.',
        );
      }
    }
    await this.db.insert(consents).values(items.map((item) => ({ userId, ...item })));
  }

  async currentConsents(
    userId: string,
  ): Promise<Record<string, { granted: boolean; version: string }>> {
    const rows = await this.db
      .select({ kind: consents.kind, granted: consents.granted, version: consents.version })
      .from(consents)
      .where(eq(consents.userId, userId))
      .orderBy(desc(consents.createdAt), desc(consents.id));
    const latest: Record<string, { granted: boolean; version: string }> = {};
    for (const row of rows) latest[row.kind] ??= { granted: row.granted, version: row.version };
    return latest;
  }

  private hasRequiredConsents(
    state: Record<string, { granted: boolean; version: string }>,
  ): boolean {
    const versions: Record<string, string> = {
      terms: this.legal.termsVersion,
      privacy: this.legal.privacyVersion,
    };
    return requiredConsents.every(
      (kind) => state[kind]?.granted === true && state[kind]?.version === versions[kind],
    );
  }

  /** Permanently deletes the account and all owned rows; stored files are removed by the worker. */
  async acknowledgeNotice(userId: string, noticeId: string): Promise<void> {
    const updated = await this.db
      .update(moderationLog)
      .set({ acknowledgedAt: new Date() })
      .where(and(eq(moderationLog.id, noticeId), eq(moderationLog.targetId, userId)))
      .returning({ id: moderationLog.id });
    if (updated.length === 0) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
  }

  async deleteAccount(userId: string): Promise<void> {
    const keys = await this.db
      .select({ quarantineKey: photos.quarantineKey, mediaKey: photos.mediaKey })
      .from(photos)
      .where(eq(photos.userId, userId));
    await this.db.transaction(async (tx) => {
      await tx.delete(user).where(eq(user.id, userId));
      await audit(tx, {
        actorId: null,
        action: 'account.deleted',
        targetType: 'user',
        targetId: userId,
      });
    });
    await this.mediaQueue.deleteObjects({
      quarantineKeys: keys.flatMap((k) => (k.quarantineKey ? [k.quarantineKey] : [])),
      mediaKeys: keys.flatMap((k) => (k.mediaKey ? [k.mediaKey] : [])),
    });
  }
}
