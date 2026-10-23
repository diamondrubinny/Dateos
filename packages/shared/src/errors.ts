// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';

/** Stable, machine-readable error codes shared by the API and its clients. */
export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  ValidationError: 'VALIDATION_ERROR',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  Gone: 'GONE',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  RateLimited: 'RATE_LIMITED',
  Underage: 'UNDERAGE',
  /** Staff tools need a fresh TOTP check for this session. */
  MfaRequired: 'MFA_REQUIRED',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  /** Focus mode (phase 20): reply to the people waiting before liking new ones. */
  YourTurn: 'YOUR_TURN',
  /** Phase 24: this form needs the CAPTCHA (bot protection) answered first. */
  CaptchaRequired: 'CAPTCHA_REQUIRED',
  Internal: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** Every non-2xx API response uses this envelope. It never contains stack traces or internals. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    requestId: z.string().optional(),
    issues: z.array(validationIssueSchema).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
