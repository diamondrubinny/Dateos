// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  defaultIdentitySettings,
  identityVocabularies,
  intentions,
  intentionSchema,
  genderSchema,
  BRAND_ICON_NAMES,
  deriveBrand,
  type InstanceInfo,
  instanceSchema,
  localeSchema,
  setupClaimSchema,
  signupModes,
  introductionOrders,
  partnerCardModes,
  webManifest,
  webPushConfigSchema,
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
    discreetName: null,
    operatorName: null,
    contactEmail: null,
    setupRequired: false,
    calls: false,
    transcripts: false,
    signup: 'open',
    identity: defaultIdentitySettings,
    community: {
      ageCheck: false,
      intentions: [...intentions],
      faith: false,
      photosAfterMatch: false,
      safetyResources: null,
      riskCountries: [],
      join: { minAge: 18, maxAge: null, genders: [], declaration: null },
    },
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

  // Phase 60: whether the web app can turn on notifications, and the key to subscribe with.
  app.get(
    '/v1/push/web',
    { schema: { response: { 200: webPushConfigSchema } } },
    async (_request, reply) => {
      reply.header('cache-control', 'public, max-age=300');
      return {
        enabled: Boolean(env.WEB_PUSH_PUBLIC_KEY),
        publicKey: env.WEB_PUSH_PUBLIC_KEY ?? null,
      };
    },
  );

  // Phase 57: the web app manifest, from the community's branding. Caddy serves it on the app's
  // own domain as /manifest.webmanifest (infra/web/Caddyfile), so its paths are the app's.
  app.get('/v1/instance/manifest.webmanifest', async (_request, reply) => {
    const info = instance ? await instance.info() : fallback;
    return reply
      .type('application/manifest+json; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(JSON.stringify(webManifest(info)));
  });

  // Phase 59: the installed app's icons, from the community's logo. Served on the app's domain as
  // /brand-icons/* (infra/web/Caddyfile); without a logo, the built-in icons there.
  app.get(
    '/v1/instance/icons/:name',
    { schema: { params: z.object({ name: z.enum(BRAND_ICON_NAMES) }) } },
    async (request, reply) => {
      const icon = instance ? await instance.brandIcon(request.params.name) : null;
      if (!icon) {
        return reply
          .header('cache-control', 'public, max-age=300')
          .redirect(`/icons/${request.params.name}`, 302);
      }
      return reply.type('image/png').header('cache-control', 'public, max-age=86400').send(icon);
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
  identityVocabulary: z.enum(identityVocabularies),
  identityCustom: z.boolean(),
  identityPronouns: z.boolean(),
  intentionsOffered: z.array(intentionSchema),
  faithModule: z.boolean(),
  photosAfterMatch: z.boolean(),
  safetyResources: z.string().nullable(),
  discreetName: z.string().nullable(),
  riskCountries: z.array(z.string()),
  partnerCards: z.enum(partnerCardModes),
  shareTrustSignals: z.boolean(),
  communityCountry: z.string().nullable(),
  introductionOrder: z.enum(introductionOrders),
  introductionHours: z.number().int(),
  profileApproval: z.boolean(),
  joinMinAge: z.number().int(),
  joinMaxAge: z.number().int().nullable(),
  joinGenders: z.array(genderSchema),
  joinDeclaration: z.string().nullable(),
  ageCheckConfigured: z.boolean(),
  ageCheckRequired: z.boolean(),
});
