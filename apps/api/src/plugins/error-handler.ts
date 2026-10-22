import { ErrorCode, type ApiError, type ValidationIssue } from '@dateos/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

/** Throw from services to return a specific, safe error to the client. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const statusToCode: Record<number, ErrorCode> = {
  400: ErrorCode.BadRequest,
  401: ErrorCode.Unauthorized,
  403: ErrorCode.Forbidden,
  404: ErrorCode.NotFound,
  409: ErrorCode.Conflict,
  410: ErrorCode.Gone,
  413: ErrorCode.PayloadTooLarge,
  415: ErrorCode.BadRequest,
  429: ErrorCode.RateLimited,
  503: ErrorCode.ServiceUnavailable,
};

const safeMessages: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.BadRequest]: 'The request could not be processed.',
  [ErrorCode.PayloadTooLarge]: 'The request body is too large.',
  [ErrorCode.RateLimited]: 'Too many requests. Please try again later.',
  [ErrorCode.Internal]: 'Something went wrong. Please try again later.',
};

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: ErrorCode,
  message: string,
  issues?: ValidationIssue[],
) {
  const body: ApiError = {
    error: { code, message, requestId: request.id, ...(issues ? { issues } : {}) },
  };
  return reply.status(statusCode).send(body);
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    send(reply, request, 404, ErrorCode.NotFound, 'Resource not found.'),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      return send(reply, request, error.statusCode, error.code, error.message);
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = error.validation.map((item) => ({
        path: `${error.validationContext ?? 'request'}${item.instancePath.replaceAll('/', '.')}`,
        message: item.message ?? 'Invalid value',
      }));
      return send(reply, request, 400, ErrorCode.ValidationError, 'Invalid request.', issues);
    }

    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return send(reply, request, 400, ErrorCode.ValidationError, 'Invalid request.', issues);
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      const code = statusToCode[statusCode] ?? ErrorCode.BadRequest;
      return send(reply, request, statusCode, code, safeMessages[code] ?? error.message);
    }

    // Unknown failures: log the full error server-side, return a generic message to the client.
    request.log.error({ err: error }, 'unhandled error');
    return send(reply, request, 500, ErrorCode.Internal, safeMessages[ErrorCode.Internal]!);
  });
}
