import { ErrorCode } from '@dateos/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { HttpError } from '../plugins/error-handler.js';
import { exchangeNativeCode, nativeRedirect } from './native-handoff.js';
import { AUTH_BASE_PATH, CLIENT_IP_HEADER, type Auth } from './auth.js';

/** Headers a client could use to spoof its IP and bypass auth rate limits. */
const SPOOFABLE_HEADERS = new Set([
  'x-forwarded-for',
  'x-real-ip',
  'x-client-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'forwarded',
  CLIENT_IP_HEADER,
]);

export function toFetchRequest(request: FastifyRequest, origin: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || SPOOFABLE_HEADERS.has(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set(CLIENT_IP_HEADER, request.ip);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body != null;
  return new Request(new URL(request.url, origin), {
    method: request.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
  });
}

export async function authRoutes(
  app: FastifyInstance,
  {
    auth,
    origin,
    redis,
    appScheme,
  }: { auth: Auth; origin: string; redis: Redis; appScheme: string },
) {
  const exchangeBody = z.object({
    code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  });
  app.post(
    `${AUTH_BASE_PATH}/native/exchange`,
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const parsed = exchangeBody.safeParse(request.body);
      const cookies = parsed.success
        ? await exchangeNativeCode(redis, parsed.data.code, parsed.data.verifier)
        : null;
      if (!cookies)
        throw new HttpError(400, ErrorCode.BadRequest, 'This sign-in link has expired.');
      reply.header('cache-control', 'no-store');
      reply.header('set-cookie', cookies);
      return { ok: true as const };
    },
  );

  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    async handler(request, reply) {
      const response = await auth.handler(toFetchRequest(request, origin));
      const native = await nativeRedirect(
        redis,
        appScheme,
        response.headers.get('location'),
        response.headers.getSetCookie(),
      );
      if (native) {
        // The session goes to the app through the code exchange, never to the browser or a URL.
        return reply.status(302).header('cache-control', 'no-store').redirect(native.location);
      }
      reply.status(response.status);
      response.headers.forEach((value, name) => {
        if (name === 'set-cookie') return;
        reply.header(name, value);
      });
      // Multiple cookies must be forwarded as separate Set-Cookie headers.
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
}
