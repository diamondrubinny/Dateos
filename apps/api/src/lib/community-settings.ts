// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  defaultIdentitySettings,
  intentions,
  type IdentitySettings,
  type Intention,
} from '@nexaheart/shared';
import { eq } from 'drizzle-orm';

/** Phase 62a: what the community offers for gender identity and pronouns (read fresh). */
export async function readIdentitySettings(db: Database): Promise<IdentitySettings> {
  const [row] = await db
    .select({
      vocabulary: schema.instanceSettings.identityVocabulary,
      customGender: schema.instanceSettings.identityCustom,
      pronouns: schema.instanceSettings.identityPronouns,
    })
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1));
  return row
    ? {
        vocabulary: row.vocabulary === 'basic' ? 'basic' : 'extended',
        customGender: row.customGender,
        pronouns: row.pronouns,
      }
    : defaultIdentitySettings;
}

/**
 * Phase 62b: the intentions this community offers (all, unless an admin narrowed them) and
 * whether its faith module is on (read fresh).
 */
export async function readCommunitySettings(
  db: Database,
): Promise<{ intentions: Intention[]; faith: boolean }> {
  const [row] = await db
    .select({
      intentions: schema.instanceSettings.intentionsOffered,
      faith: schema.instanceSettings.faithModule,
    })
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1));
  const offered = (row?.intentions ?? []).filter((i): i is Intention =>
    (intentions as readonly string[]).includes(i),
  );
  return { intentions: offered.length > 0 ? offered : [...intentions], faith: row?.faith ?? false };
}
