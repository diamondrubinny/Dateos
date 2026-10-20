import type { FastifyInstance, FastifyRequest } from 'fastify';
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
  { auth, origin }: { auth: Auth; origin: string },
) {
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    async handler(request, reply) {
      const response = await auth.handler(toFetchRequest(request, origin));
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
