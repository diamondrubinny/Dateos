// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { profileText, type EmbeddingProvider } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  MODERATION_LOG_RETENTION_DAYS,
  RESOLVED_REPORT_RETENTION_DAYS,
  UNMATCHED_CHAT_RETENTION_DAYS,
  VERIFICATION_RECORD_RETENTION_DAYS,
  type EmbedProfileJob,
} from '@nexaheart/shared';
import type { Storage } from '@nexaheart/storage';
import { asc, eq, sql } from 'drizzle-orm';

const { profiles, prompts, profileEmbeddings } = schema;

/** Retention for fairness counters and daily picks (see docs/phases/PHASE-2.md). */
export const DISCOVERY_RETENTION_DAYS = 30;

export async function embedProfile(
  db: Database,
  provider: EmbeddingProvider,
  { userId }: EmbedProfileJob,
): Promise<'embedded' | 'cleared' | 'skipped'> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!profile) return 'skipped'; // account deleted meanwhile
  const answers = await db
    .select({ promptKey: prompts.promptKey, answer: prompts.answer })
    .from(prompts)
    .where(eq(prompts.userId, userId))
    .orderBy(asc(prompts.position));
  const text = profileText({ bio: profile.bio, intention: profile.intention, prompts: answers });
  if (!text) {
    await db.delete(profileEmbeddings).where(eq(profileEmbeddings.userId, userId));
    return 'cleared';
  }
  const [embedding] = await provider.embed([text]);
  await db
    .insert(profileEmbeddings)
    .values({ userId, embedding: embedding!, model: provider.model })
    .onConflictDoUpdate({
      target: profileEmbeddings.userId,
      set: { embedding: embedding!, model: provider.model, updatedAt: new Date() },
    });
  return 'embedded';
}

export async function cleanupDiscovery(
  db: Database,
): Promise<{ impressions: number; picks: number }> {
  const days = sql.raw(String(DISCOVERY_RETENTION_DAYS));
  const impressions = await db.execute(
    sql`DELETE FROM impressions WHERE created_at < now() - interval '${days} days'`,
  );
  const picks = await db.execute(
    sql`DELETE FROM daily_picks WHERE served_on < current_date - ${days}`,
  );
  return { impressions: impressions.rowCount ?? 0, picks: picks.rowCount ?? 0 };
}

/**
 * Chats of unmatched pairs are kept briefly (so a report can still be filed in phase 4) and then
 * purged, including the stored chat images.
 */
export async function purgeClosedChats(
  db: Database,
  storage: Storage,
): Promise<{ messages: number; images: number; voice: number }> {
  const days = sql.raw(String(UNMATCHED_CHAT_RETENTION_DAYS));
  const images = await db.execute<{
    id: string;
    media_key: string | null;
    quarantine_key: string | null;
  }>(sql`
    SELECT p.id, p.media_key, p.quarantine_key FROM photos p
    JOIN messages m ON m.photo_id = p.id JOIN matches ma ON ma.id = m.match_id
    WHERE p.purpose = 'chat' AND ma.unmatched_at < now() - interval '${days} days'`);
  const keys = (field: 'media_key' | 'quarantine_key') =>
    images.rows.flatMap((r) => (r[field] ? [r[field]!] : []));
  await storage.delete(storage.buckets.media, keys('media_key'));
  await storage.delete(storage.buckets.quarantine, keys('quarantine_key'));
  // Voice messages in the same chats.
  const clips = await db.execute<{
    id: string;
    media_key: string | null;
    opus_key: string | null;
    quarantine_key: string | null;
  }>(sql`
    SELECT a.id, a.media_key, a.opus_key, a.quarantine_key FROM audio_clips a
    JOIN messages m ON m.audio_id = a.id JOIN matches ma ON ma.id = m.match_id
    WHERE ma.unmatched_at < now() - interval '${days} days'`);
  const clipKeys = (field: 'media_key' | 'opus_key' | 'quarantine_key') =>
    clips.rows.flatMap((r) => (r[field] ? [r[field]!] : []));
  await storage.delete(storage.buckets.media, [...clipKeys('media_key'), ...clipKeys('opus_key')]);
  await storage.delete(storage.buckets.quarantine, clipKeys('quarantine_key'));
  const deleted = await db.execute(sql`
    DELETE FROM messages m USING matches ma
    WHERE ma.id = m.match_id AND ma.unmatched_at < now() - interval '${days} days'`);
  // Date ideas of the same chats (their cards were among the messages above).
  await db.execute(sql`
    DELETE FROM date_plans d USING matches ma
    WHERE ma.id = d.match_id AND ma.unmatched_at < now() - interval '${days} days'`);
  // And the call log of those chats (who called when; there is never any audio or video).
  await db.execute(sql`
    DELETE FROM calls c USING matches ma
    WHERE ma.id = c.match_id AND ma.unmatched_at < now() - interval '${days} days'`);
  if (images.rows.length > 0) {
    const ids = sql.join(
      images.rows.map((r) => sql`${r.id}::uuid`),
      sql`, `,
    );
    await db.execute(sql`DELETE FROM photos WHERE id IN (${ids})`);
  }
  if (clips.rows.length > 0) {
    const ids = sql.join(
      clips.rows.map((r) => sql`${r.id}::uuid`),
      sql`, `,
    );
    await db.execute(sql`DELETE FROM audio_clips WHERE id IN (${ids})`);
  }
  return { messages: deleted.rowCount ?? 0, images: images.rows.length, voice: clips.rows.length };
}

/** Deletes moderation records past their retention period (evidence goes with its report). */
export async function cleanupModeration(
  db: Database,
  storage?: Storage,
  /** Evidence files younger than this are kept (their report may not be committed yet). */
  evidenceGraceMs = 3_600_000,
): Promise<{ reports: number; actions: number; verifications: number; evidenceFiles: number }> {
  const days = (n: number) => sql.raw(String(n));
  const reports = await db.execute(sql`
    DELETE FROM reports WHERE status <> 'open'
      AND resolved_at < now() - interval '${days(RESOLVED_REPORT_RETENTION_DAYS)} days'`);
  const actions = await db.execute(sql`
    DELETE FROM moderation_actions
    WHERE created_at < now() - interval '${days(MODERATION_LOG_RETENTION_DAYS)} days'`);
  const verifications = await db.execute(sql`
    DELETE FROM verifications
    WHERE (decided_at < now() - interval '${days(VERIFICATION_RECORD_RETENTION_DAYS)} days')
       OR (status = 'awaiting_selfie' AND created_at < now() - interval '7 days')`);
  // Step-up records are only valid for 12 hours anyway.
  await db.execute(
    sql`DELETE FROM staff_sessions WHERE mfa_verified_at < now() - interval '1 day'`,
  );
  // Voice evidence files whose report no longer exists (retention or account deletion).
  let evidenceFiles = 0;
  if (storage) {
    // Files younger than an hour may belong to a report whose transaction hasn't committed yet.
    const keys = await storage.listKeys(storage.buckets.media, 'evidence/', {
      olderThan: new Date(Date.now() - evidenceGraceMs),
    });
    const reportIds = [...new Set(keys.map((k) => k.split('/')[1]!).filter(Boolean))];
    if (reportIds.length > 0) {
      const existing = await db.execute<{ id: string }>(
        sql`SELECT id::text FROM reports WHERE id::text IN (${sql.join(
          reportIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
      const kept = new Set(existing.rows.map((r) => r.id));
      const orphaned = keys.filter((k) => !kept.has(k.split('/')[1]!));
      await storage.delete(storage.buckets.media, orphaned);
      evidenceFiles = orphaned.length;
    }
  }
  return {
    reports: reports.rowCount ?? 0,
    actions: actions.rowCount ?? 0,
    verifications: verifications.rowCount ?? 0,
    evidenceFiles,
  };
}
