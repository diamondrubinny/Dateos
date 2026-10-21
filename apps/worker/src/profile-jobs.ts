import { profileText, type EmbeddingProvider } from '@dateos/ai';
import { schema, type Database } from '@dateos/db';
import {
  MODERATION_LOG_RETENTION_DAYS,
  RESOLVED_REPORT_RETENTION_DAYS,
  UNMATCHED_CHAT_RETENTION_DAYS,
  VERIFICATION_RECORD_RETENTION_DAYS,
  type EmbedProfileJob,
} from '@dateos/shared';
import type { Storage } from '@dateos/storage';
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
): Promise<{ messages: number; images: number }> {
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
  const deleted = await db.execute(sql`
    DELETE FROM messages m USING matches ma
    WHERE ma.id = m.match_id AND ma.unmatched_at < now() - interval '${days} days'`);
  if (images.rows.length > 0) {
    const ids = sql.join(
      images.rows.map((r) => sql`${r.id}::uuid`),
      sql`, `,
    );
    await db.execute(sql`DELETE FROM photos WHERE id IN (${ids})`);
  }
  return { messages: deleted.rowCount ?? 0, images: images.rows.length };
}

/** Deletes moderation records past their retention period (evidence goes with its report). */
export async function cleanupModeration(
  db: Database,
): Promise<{ reports: number; actions: number; verifications: number }> {
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
  return {
    reports: reports.rowCount ?? 0,
    actions: actions.rowCount ?? 0,
    verifications: verifications.rowCount ?? 0,
  };
}
