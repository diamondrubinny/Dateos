import { ErrorCode } from '@dateos/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../plugins/error-handler.js';
import type { Auth } from './auth.js';

export interface AuthUser {
  id: string;
  email: string;
  status: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

function toHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

/** preHandler: rejects requests without a valid session or from non-active accounts. */
export function requireUser(auth: Auth) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const result = await auth.api.getSession({ headers: toHeaders(request) });
    if (!result) throw new HttpError(401, ErrorCode.Unauthorized, 'Sign in required.');
    const { id, email } = result.user;
    const { status, role } = result.user as typeof result.user & { status?: string; role?: string };
    if (status === 'suspended') {
      throw new HttpError(403, ErrorCode.Forbidden, 'This account cannot perform this action.');
    }
    request.authUser = { id, email, status, role: role ?? 'user' };
  };
}

export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw new HttpError(401, ErrorCode.Unauthorized, 'Sign in required.');
  return request.authUser;
}
