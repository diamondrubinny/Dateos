// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { isUnavailableAnswer, isUnavailableError } from '../src/lib/server-status';

describe('the server not answering vs saying no (phase 55)', () => {
  it('no answer, a proxy’s 502/503/504, or the proxy’s SERVER_RESTARTING: unreachable', () => {
    expect(isUnavailableAnswer(0, undefined)).toBe(true);
    expect(isUnavailableAnswer(502, undefined)).toBe(true);
    expect(isUnavailableAnswer(503, undefined)).toBe(true);
    expect(isUnavailableAnswer(504, undefined)).toBe(true);
    expect(isUnavailableAnswer(503, 'SERVER_RESTARTING')).toBe(true);
  });

  it('an error the API sent is not an outage: a feature that’s off, a partner down, signed out', () => {
    expect(isUnavailableAnswer(503, 'SERVICE_UNAVAILABLE')).toBe(false);
    expect(isUnavailableAnswer(502, 'BAD_GATEWAY')).toBe(false);
    expect(isUnavailableAnswer(401, 'UNAUTHORIZED')).toBe(false);
    expect(isUnavailableAnswer(500, undefined)).toBe(false);
    expect(isUnavailableAnswer(200, undefined)).toBe(false);
  });

  it('reads our errors and better-auth’s alike', () => {
    expect(isUnavailableError({ status: 0, code: 'NETWORK_ERROR' })).toBe(true);
    // better-auth: a failed fetch has no status; an HTTP error carries the body's fields.
    expect(isUnavailableError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isUnavailableError({ status: 502, statusText: 'Bad Gateway' })).toBe(true);
    expect(
      isUnavailableError({ status: 503, error: { code: 'SERVER_RESTARTING', message: '…' } }),
    ).toBe(true);
    expect(isUnavailableError({ status: 401, statusText: 'Unauthorized' })).toBe(false);
    expect(isUnavailableError({ status: 503, code: 'SERVICE_UNAVAILABLE' })).toBe(false);
    expect(isUnavailableError(null)).toBe(false);
  });
});
