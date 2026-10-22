// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  ageOn,
  ErrorCode,
  MIN_AGE,
  MIN_PHOTOS,
  requiredConsents,
  SENSITIVE_CONSENT_VERSION,
  type ConsentInput,
  type MeResponse,
  pauseEndsAt,
  type PauseDuration,
  type OnboardingStep,
  type Preferences,
  type ProfileInput,
  type ProfileUpdate,
  type PromptAnswer,
} from '@nexaheart/shared';
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
      .select({
        id: user.id,
        email: user.email,
        status: user.status,
        pausedAt: user.pausedAt,
        pausedUntil: user.pausedUntil,
      })
      .from(user)
      .where(eq(user.id, userId));
    if (!account) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
    // A break that has ended is over even before the worker clears it.
    const onBreak =
      account.pausedAt !== null &&
      (account.pausedUntil === null || account.pausedUntil > new Date());

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
    if (!this.hasRequiredConsents(consentState)) missing.push('consents');
    if (!profile) missing.push('profile');
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
      user: { id: account.id, email: account.email, status: account.status },
      pause: onBreak
        ? {
            since: account.pausedAt!.toISOString(),
            until: account.pausedUntil?.toISOString() ?? null,
          }
        : null,
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

  /**
   * "Take a break" (phase 18a): hidden from new people until `duration` ends, or until the member
   * comes back. Matches and chats carry on. Choosing again replaces the end time.
   */
  async pause(userId: string, duration: PauseDuration, now = new Date()): Promise<void> {
    await this.db
      .update(user)
      .set({ pausedAt: now, pausedUntil: pauseEndsAt(duration, now) })
      .where(eq(user.id, userId));
  }

  async resume(userId: string): Promise<void> {
    await this.db
      .update(user)
      .set({ pausedAt: null, pausedUntil: null })
      .where(eq(user.id, userId));
  }

  /** Creates the profile. Birth date is final: an underage date suspends the account. */
  async createProfile(userId: string, input: ProfileInput): Promise<void> {
    await this.assertConsented(userId);
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
    if (values.gender !== undefined || values.interestedIn !== undefined) {
      await this.assertConsented(userId);
    }
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
    const expected = this.consentVersions();
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
    const sensitive = items.find((item) => item.kind === 'sensitive');
    await this.db.transaction(async (tx) => {
      await tx.insert(consents).values(items.map((item) => ({ userId, ...item })));
      // Withdrawing consent for sensitive data stops matching on it: the profile is hidden from
      // discovery ('paused') until the person agrees again. Suspensions are never lifted here.
      // Withdrawing location consent also deletes the stored (approximate) location.
      if (items.some((item) => item.kind === 'location' && !item.granted)) {
        await tx.delete(locations).where(eq(locations.userId, userId));
      }
      if (sensitive) {
        await tx
          .update(user)
          .set({ status: sensitive.granted ? 'active' : 'paused' })
          .where(
            and(eq(user.id, userId), eq(user.status, sensitive.granted ? 'paused' : 'active')),
          );
      }
    });
  }

  /** Profile data (gender, interests) may only be stored once the required consents exist. */
  private async assertConsented(userId: string): Promise<void> {
    if (!this.hasRequiredConsents(await this.currentConsents(userId))) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Please accept the required consents first.');
    }
  }

  private consentVersions(): Partial<Record<string, string>> {
    return {
      terms: this.legal.termsVersion,
      privacy: this.legal.privacyVersion,
      sensitive: SENSITIVE_CONSENT_VERSION,
    };
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
    const versions = this.consentVersions();
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
    const clips = await this.db
      .select({
        quarantineKey: schema.audioClips.quarantineKey,
        mediaKey: schema.audioClips.mediaKey,
        opusKey: schema.audioClips.opusKey,
      })
      .from(schema.audioClips)
      .where(eq(schema.audioClips.userId, userId));
    keys.push(
      ...clips.flatMap((c) => [
        { quarantineKey: c.quarantineKey, mediaKey: c.mediaKey },
        { quarantineKey: null, mediaKey: c.opusKey },
      ]),
    );
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
