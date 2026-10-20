import { instanceSchema, type InstanceInfo } from '@dateos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Env } from '../../config/env.js';

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
    },
    sponsorUrl: env.SPONSOR_URL ?? null,
    legal: { termsVersion: env.TERMS_VERSION, privacyVersion: env.PRIVACY_VERSION },
  };
}

/** Public: branding and enabled features, so clients can render before sign-in. */
export const instanceRoutes: FastifyPluginAsyncZod<{ env: Env }> = async (app, { env }) => {
  const info = instanceInfo(env);
  app.get('/v1/instance', { schema: { response: { 200: instanceSchema } } }, async () => info);
};
