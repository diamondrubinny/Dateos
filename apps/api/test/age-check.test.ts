// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { ageCheckCallbackSchema, type AgeCheckCallback } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import { signAgeCheck, validAgeCheckSignature } from '../src/modules/age-check/service.js';

const secret = 'unit-test-only-secret-0123456789abcdef';
const body: AgeCheckCallback = {
  session: '00000000-0000-4000-8000-000000000001',
  result: 'over_18',
  method: 'eudi_wallet',
  ts: 1_800_000_000,
};

describe('age-check signatures (phase 63)', () => {
  it('accepts the provider’s own signature and nothing else', () => {
    const signature = signAgeCheck(secret, body);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(validAgeCheckSignature(secret, body, signature)).toBe(true);
    expect(validAgeCheckSignature('another-secret-0123456789abcdef0123', body, signature)).toBe(
      false,
    );
    // Every signed field matters.
    for (const changed of [
      { ...body, result: 'under_18' as const },
      { ...body, method: 'other' },
      { ...body, ts: body.ts + 1 },
      { ...body, session: '00000000-0000-4000-8000-000000000002' },
    ]) {
      expect(validAgeCheckSignature(secret, changed, signature)).toBe(false);
    }
    expect(validAgeCheckSignature(secret, body, signature.toUpperCase())).toBe(false);
    expect(validAgeCheckSignature(secret, body, signature.slice(2))).toBe(false);
  });

  it('the callback carries only the result: unknown fields are refused', () => {
    expect(ageCheckCallbackSchema.safeParse(body).success).toBe(true);
    expect(ageCheckCallbackSchema.safeParse({ ...body, birthDate: '2000-01-01' }).success).toBe(
      false,
    );
    expect(ageCheckCallbackSchema.safeParse({ ...body, method: 'Has Spaces' }).success).toBe(false);
  });
});
