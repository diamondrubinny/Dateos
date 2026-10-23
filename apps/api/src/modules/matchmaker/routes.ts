// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { interpretText, type MatchmakerCurrent, mergeChoices, suggestChanges } from '@nexaheart/ai';
import {
  ErrorCode,
  MATCHMAKER_DAILY,
  matchmakerAnswersSchema,
  matchmakerApplySchema,
  matchmakerInfoSchema,
  matchmakerResultSchema,
  type MeResponse,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import type { AiGate } from '../../lib/ai-gate.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';
import type { MeService } from '../me/service.js';

function currentOf(me: MeResponse): MatchmakerCurrent {
  if (!me.profile || !me.preferences) {
    throw new HttpError(409, ErrorCode.Conflict, 'Finish your profile first.');
  }
  return {
    age: me.profile.age,
    intention: me.profile.intention,
    maxDistanceKm: me.preferences.maxDistanceKm,
    ageMin: me.preferences.ageMin,
    ageMax: me.preferences.ageMax,
    interests: me.about.interests,
    smokingOk: me.dealbreakers.smokingOk,
    childrenOk: me.dealbreakers.childrenOk,
  };
}

/**
 * The matchmaker (phase 23): answers become suggested changes, and only the ones the member picks
 * are applied. Nothing about the interview is stored. A model reads the free text only when one is
 * available (local, or external with the `ai_cloud` consent).
 */
export const matchmakerRoutes: FastifyPluginAsyncZod<{
  auth: Auth;
  me: MeService;
  ai: AiGate;
}> = async (app, { auth, me, ai }) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/me/matchmaker',
    { schema: { response: { 200: matchmakerInfoSchema } } },
    async (request) => ({ text: await ai.availability(currentUser(request).id) }),
  );

  app.post(
    '/v1/me/matchmaker/suggest',
    {
      config: perUserLimit(MATCHMAKER_DAILY, 24 * 60 * 60_000),
      schema: { body: matchmakerAnswersSchema, response: { 200: matchmakerResultSchema } },
    },
    async (request) => {
      const userId = currentUser(request).id;
      const current = currentOf(await me.getMe(userId));
      const { choices, text } = request.body;
      let read = {};
      let usedText = false;
      let textSkipped: 'needs_consent' | 'unavailable' | null = null;
      if (text) {
        const availability = await ai.availability(userId);
        const model = availability === 'available' ? await ai.modelFor(userId) : null;
        if (model) {
          read = await interpretText(model, text);
          usedText = true;
        } else {
          textSkipped = availability === 'needs_consent' ? 'needs_consent' : 'unavailable';
        }
      }
      return {
        suggestions: suggestChanges(mergeChoices(choices, read), current),
        usedText,
        textSkipped,
      };
    },
  );

  app.post(
    '/v1/me/matchmaker/apply',
    {
      config: perUserLimit(30, 60 * 60_000),
      schema: { body: matchmakerApplySchema, response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async (request) => {
      const userId = currentUser(request).id;
      const mine = await me.getMe(userId);
      currentOf(mine);
      const prefs = { ...mine.preferences! };
      const about = { ...mine.about };
      const deal = { ...mine.dealbreakers };
      let intention: NonNullable<MeResponse['profile']>['intention'] | null = null;
      let prefsChanged = false;
      let aboutChanged = false;
      let dealChanged = false;
      for (const change of request.body.changes) {
        switch (change.field) {
          case 'intention':
            intention = change.value;
            break;
          case 'maxDistanceKm':
            prefs.maxDistanceKm = change.value;
            prefsChanged = true;
            break;
          case 'ages':
            prefs.ageMin = change.value.ageMin;
            prefs.ageMax = change.value.ageMax;
            prefsChanged = true;
            break;
          case 'interests':
            about.interests = change.value;
            aboutChanged = true;
            break;
          case 'smokingOk':
            deal.smokingOk = change.value;
            dealChanged = true;
            break;
          case 'childrenOk':
            deal.childrenOk = change.value;
            dealChanged = true;
            break;
        }
      }
      // The same setters (and checks) as the settings screens.
      if (intention) await me.updateProfile(userId, { intention });
      if (prefsChanged) await me.setPreferences(userId, prefs);
      if (aboutChanged) await me.setAbout(userId, about);
      if (dealChanged) await me.setDealbreakers(userId, deal);
      return { ok: true as const };
    },
  );
};
