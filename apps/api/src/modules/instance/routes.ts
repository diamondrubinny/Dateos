// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  deriveBrand,
  type InstanceInfo,
  instanceSchema,
  localeSchema,
  setupClaimSchema,
  signupModes,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import type { Env } from '../../config/env.js';
import { poweredBy } from '../../lib/credit.js';
import { perUserLimit } from '../../plugins/security.js';
import type { IntegrationService } from '../integrations/service.js';
import type { InstanceService } from './service.js';

/** Branding from the environment only (health-only setups without a database). */
export function instanceInfo(env: Env): InstanceInfo {
  return {
    name: env.INSTANCE_NAME,
    tagline: env.INSTANCE_TAGLINE,
    primaryColor: env.INSTANCE_PRIMARY_COLOR,
    locales: env.INSTANCE_LOCALES,
    defaultLocale: env.INSTANCE_DEFAULT_LOCALE,
    auth: {
      magicLink: true,
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      apple: Boolean(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
      passkey: false,
    },
    sponsorUrl: env.SPONSOR_URL ?? null,
    legal: { termsVersion: env.TERMS_VERSION, privacyVersion: env.PRIVACY_VERSION },
    brand: deriveBrand(env.INSTANCE_PRIMARY_COLOR),
    logoUrl: null,
    operatorName: null,
    contactEmail: null,
    setupRequired: false,
    calls: false,
    transcripts: false,
    signup: 'open',
    integrations: { captcha: null, analytics: null, webErrors: false },
    poweredBy: poweredBy(env),
  };
}

/** Public: branding and enabled features, so clients can render before sign-in. */
export const instanceRoutes: FastifyPluginAsyncZod<{
  env: Env;
  instance?: InstanceService;
  integrations?: IntegrationService;
}> = async (app, { env, instance, integrations }) => {
  const fallback = instanceInfo(env);
  app.get(
    '/v1/instance',
    { schema: { response: { 200: instanceSchema } } },
    async (_request, reply) => {
      reply.header('cache-control', 'public, max-age=15');
      if (!instance) return fallback;
      const info = await instance.info();
      return {
        ...info,
        integrations: integrations ? await integrations.publicInfo() : fallback.integrations,
      };
    },
  );

  if (!instance) return;
  app.get('/v1/instance/logo', async (_request, reply) => {
    const object = await instance.logo();
    return (
      reply
        .type('image/webp')
        .header('cache-control', 'public, max-age=86400')
        // Displayed by the web app and the dashboard on other origins of the same instance.
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(object.body)
    );
  });
};

/** First-run claim of a fresh instance with the setup token (see docs/SELF_HOSTING.md). */
export const setupRoutes: FastifyPluginAsyncZod<{ auth: Auth; instance: InstanceService }> = async (
  app,
  { auth, instance },
) => {
  app.addHook('preHandler', requireUser(auth));
  app.post(
    '/v1/setup/claim',
    {
      schema: { body: setupClaimSchema, response: { 200: z.object({ ok: z.literal(true) }) } },
      config: perUserLimit(5, 60 * 60 * 1000),
    },
    async (request) => {
      await instance.claim(currentUser(request), request.body.token);
      return { ok: true as const };
    },
  );
};

export const adminSettingsSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  primaryColor: z.string(),
  defaultLocale: localeSchema,
  operatorName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  sponsorUrl: z.string().nullable(),
  logoUrl: z.string().nullable(),
  setupCompleted: z.boolean(),
  callsConfigured: z.boolean(),
  callsEnabled: z.boolean(),
  callMaxMinutes: z.number().int(),
  signupMode: z.enum(signupModes),
  memberInvites: z.boolean(),
});
