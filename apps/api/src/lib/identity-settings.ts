// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { defaultIdentitySettings, type IdentitySettings } from '@nexaheart/shared';
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
