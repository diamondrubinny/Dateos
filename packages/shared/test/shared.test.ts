// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { apiErrorSchema, ErrorCode, isRtl, paginationQuerySchema } from '../src/index.js';

describe('apiErrorSchema', () => {
  it('accepts a well-formed error envelope', () => {
    const parsed = apiErrorSchema.parse({
      error: { code: ErrorCode.NotFound, message: 'Not found', requestId: 'abc' },
    });
    expect(parsed.error.code).toBe('NOT_FOUND');
  });

  it('rejects unknown error codes', () => {
    expect(() => apiErrorSchema.parse({ error: { code: 'NOPE', message: 'x' } })).toThrow();
  });
});

describe('paginationQuerySchema', () => {
  it('applies a default limit and coerces strings', () => {
    expect(paginationQuerySchema.parse({}).limit).toBe(20);
    expect(paginationQuerySchema.parse({ limit: '5' }).limit).toBe(5);
  });

  it('caps the limit', () => {
    expect(() => paginationQuerySchema.parse({ limit: 500 })).toThrow();
  });
});

describe('isRtl', () => {
  it('marks Hebrew as RTL and English as LTR', () => {
    expect(isRtl('he')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});
