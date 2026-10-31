// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { askAboutProfile, type AskableProfile } from '@nexaheart/ai';
import {
  askProfileAnswerSchema,
  askProfileInputSchema,
  askProfileStateSchema,
  ErrorCode,
  PROFILE_QUESTIONS_DAILY,
  type AskProfileState,
  type PublicProfile,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import type { AiGate } from '../../lib/ai-gate.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';
import type { DiscoveryService } from '../discovery/service.js';

/**
 * Only what the asker already sees, minus the sensitive parts (religion, faith, identity, needs,
 * the Match Note, relationship history), photos, the name and the distance.
 */
export function askable(p: PublicProfile): AskableProfile {
  return {
    bio: p.bio,
    prompts: p.prompts.map((x) => ({ question: x.promptKey, answer: x.answer })),
    interests: p.about?.interests ?? [],
    children: p.about?.children ?? null,
    smoking: p.about?.smoking ?? null,
    drinking: p.about?.drinking ?? null,
    heightCm: p.about?.heightCm ?? null,
    languages: p.languages,
    intention: p.intention,
    openingQuestion: p.about?.openingQuestion ?? null,
    friendTakes: p.friendTakes.map((t) => t.text),
  };
}

/** Phase 75b: ask about a profile, from its public data only. */
export const askRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  discovery: DiscoveryService;
  ai: AiGate;
}> = async (app, { auth, discovery, ai }) => {
  app.addHook('preHandler', requireUser(auth));
  const params = z.object({ id: z.string().min(1).max(64) });

  /** The asker's own consent can be asked for; the owner's is never revealed. */
  const state = async (viewerId: string, ownerId: string): Promise<AskProfileState['state']> => {
    const mine = await ai.availability(viewerId);
    if (mine !== 'available') return mine;
    return (await ai.availability(viewerId, ownerId)) === 'available' ? 'available' : 'unavailable';
  };

  app.get(
    '/v1/profiles/:id/ask',
    { schema: { params, response: { 200: askProfileStateSchema } } },
    async (request) => {
      const viewerId = currentUser(request).id;
      const profile = await discovery.profile(viewerId, request.params.id);
      return { state: await state(viewerId, profile.id) };
    },
  );

  app.post(
    '/v1/profiles/:id/ask',
    {
      config: perUserLimit(PROFILE_QUESTIONS_DAILY, 24 * 60 * 60 * 1000),
      schema: { params, body: askProfileInputSchema, response: { 200: askProfileAnswerSchema } },
    },
    async (request) => {
      const viewerId = currentUser(request).id;
      // Throws 404 for anyone the asker may not see.
      const profile = await discovery.profile(viewerId, request.params.id);
      if (profile.id === viewerId) {
        throw new HttpError(422, ErrorCode.ValidationError, 'That’s your own profile.');
      }
      if ((await state(viewerId, profile.id)) !== 'available') {
        throw new HttpError(409, ErrorCode.Conflict, 'Asking about profiles isn’t available.');
      }
      const model = await ai.modelFor(viewerId, profile.id);
      if (!model)
        throw new HttpError(409, ErrorCode.Conflict, 'Asking about profiles isn’t available.');
      return {
        answer: await askAboutProfile(model, {
          locale: request.body.locale,
          question: request.body.question,
          profile: askable(profile),
        }),
      };
    },
  );
};
