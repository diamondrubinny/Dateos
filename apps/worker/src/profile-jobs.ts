import { profileText, type EmbeddingProvider } from '@dateos/ai';
import { schema, type Database } from '@dateos/db';
import type { EmbedProfileJob } from '@dateos/shared';
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
