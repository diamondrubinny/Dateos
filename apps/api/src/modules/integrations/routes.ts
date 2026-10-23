// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { CAPTCHA_HEADER, clientErrorSchema, ErrorCode } from '@nexaheart/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from '../../plugins/error-handler.js';
import type { IntegrationService } from './service.js';

/**
 * Forms bots go for (phase 24): asking for a sign-in link, joining the waitlist, and writing a
 * friend's take without an account. When a CAPTCHA is set up, each needs its answer.
 */
const PROTECTED: { method: string; path: RegExp }[] = [
  { method: 'POST', path: /^\/v1\/auth\/sign-in\/magic-link$/ },
  { method: 'POST', path: /^\/v1\/signup\/waitlist$/ },
  { method: 'POST', path: /^\/v1\/takes\/[^/]+$/ },
];

export function needsCaptcha(request: Pick<FastifyRequest, 'method' | 'url'>): boolean {
  const path = request.url.split('?')[0] ?? '';
  return PROTECTED.some((p) => p.method === request.method && p.path.test(path));
}

/** Registered on the root app, so it also covers the auth routes better-auth handles. */
export function registerCaptcha(app: FastifyInstance, integrations: IntegrationService): void {
  app.addHook('preHandler', async (request) => {
    if (!needsCaptcha(request)) return;
    const header = request.headers[CAPTCHA_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    const result = await integrations.checkCaptcha(token, request.ip);
    if (result === 'off' || result) return;
    throw new HttpError(
      403,
      ErrorCode.CaptchaRequired,
      'Please complete the check that you’re not a bot, then try again.',
    );
  });
}

/**
 * Errors from the web app, forwarded to error monitoring when it's set up. Public (crashes can
 * happen before sign-in), small, rate-limited and scrubbed; the user isn't attached.
 */
export const clientErrorRoutes: FastifyPluginAsyncZod<{
  integrations: IntegrationService;
}> = async (app, { integrations }) => {
  app.post(
    '/v1/client-errors',
    {
      bodyLimit: 8 * 1024,
      config: { rateLimit: { max: 20, timeWindow: 60 * 60_000 } },
      schema: { body: clientErrorSchema, response: { 202: z.object({ ok: z.literal(true) }) } },
    },
    async (request, reply) => {
      const info = await integrations.publicInfo();
      if (info.webErrors) {
        await integrations.captureError(
          { type: 'Error', message: request.body.message, stack: request.body.stack },
          'javascript',
          { route: request.body.route ?? 'unknown' },
        );
      }
      return reply.status(202).send({ ok: true as const });
    },
  );
};
