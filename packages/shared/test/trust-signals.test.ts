// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { federatedSignalSchema, MAX_SIGNAL_HASHES } from '../src/index.js';

const id = '7f0c1d2e-3a4b-4c5d-8e6f-708192a3b4c5';
const ok = (hashes: string[]) =>
  federatedSignalSchema.safeParse({ id, hashes, category: 'scam' }).success;

describe('trust signals (phase 73b)', () => {
  it('takes signed 64-bit hashes as decimal strings, and nothing else', () => {
    expect(ok(['0', '-1', '9223372036854775807', '-9223372036854775808'])).toBe(true);
    expect(ok(['9223372036854775808'])).toBe(false);
    expect(ok(['-9223372036854775809'])).toBe(false);
    for (const bad of ['1e5', '0x10', '', ' 1', '1.0', 'NaN']) expect(ok([bad])).toBe(false);
  });

  it('carries only an id, the hashes and a category', () => {
    expect(ok([])).toBe(false);
    expect(ok(Array.from({ length: MAX_SIGNAL_HASHES + 1 }, (_, i) => String(i)))).toBe(false);
    expect(
      federatedSignalSchema.safeParse({ id, hashes: ['1'], category: 'scam', name: 'Ari' }).success,
    ).toBe(false);
    expect(federatedSignalSchema.safeParse({ id, hashes: ['1'], category: 'x' }).success).toBe(
      false,
    );
  });
});
