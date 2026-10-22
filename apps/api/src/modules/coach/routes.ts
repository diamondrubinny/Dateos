// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { bioIdeas, coachTips } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import { bioIdeasSchema, coachResponseSchema, ErrorCode, localeSchema } from '@nexaheart/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import type { AiGate } from '../../lib/ai-gate.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';

const { profiles, prompts, photos } = schema;

async function ownProfile(db: Database, userId: string) {
  const [profile] = await db
    .select({ bio: profiles.bio, verifiedAt: profiles.verifiedAt })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  const answers = await db
    .select({ promptKey: prompts.promptKey, answer: prompts.answer })
    .from(prompts)
    .where(eq(prompts.userId, userId))
    .orderBy(asc(prompts.position));
  const clean = await db
    .select({ id: photos.id })
    .from(photos)
    .where(
      and(eq(photos.userId, userId), eq(photos.purpose, 'profile'), eq(photos.status, 'clean')),
    );
  return { profile, answers, photoCount: clean.length };
}

/** Profile Coach: deterministic tips for everyone, optional AI bio ideas on request. */
export const coachRoutes: FastifyPluginAsyncZod<{ auth: Auth; db: Database; ai: AiGate }> = async (
  app,
  { auth, db, ai },
) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/me/coach',
    { schema: { response: { 200: coachResponseSchema } } },
    async (request) => {
      const userId = currentUser(request).id;
      const { profile, answers, photoCount } = await ownProfile(db, userId);
      if (!profile) throw new HttpError(409, ErrorCode.Conflict, 'Create your profile first.');
      return {
        tips: coachTips({
          photoCount,
          bio: profile.bio,
          prompts: answers,
          verified: profile.verifiedAt !== null,
        }),
        bioIdeas: await ai.availability(userId),
      };
    },
  );

  app.post(
    '/v1/me/coach/bio-ideas',
    {
      schema: {
        body: z.object({ locale: localeSchema }),
        response: { 200: bioIdeasSchema },
      },
      config: perUserLimit(10, 24 * 60 * 60 * 1000),
    },
    async (request) => {
      const userId = currentUser(request).id;
      const availability = await ai.availability(userId);
      if (availability !== 'available') {
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          availability === 'needs_consent'
            ? 'Turn on the external AI option in your privacy settings first.'
            : 'Bio ideas are not available on this community.',
        );
      }
      const { profile, answers } = await ownProfile(db, userId);
      if (!profile) throw new HttpError(409, ErrorCode.Conflict, 'Create your profile first.');
      // Only the person's own bio and prompt answers are used: no name, age, gender or photos.
      return {
        ideas: await bioIdeas(ai.model!, {
          locale: request.body.locale,
          bio: profile.bio,
          prompts: answers,
        }),
      };
    },
  );
};
