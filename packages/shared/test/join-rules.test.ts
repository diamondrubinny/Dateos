// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { instanceSettingsInputSchema, MAX_JOIN_DECLARATION } from '../src/branding.js';

describe('who may join (phase 62c)', () => {
  const ok = (v: Record<string, unknown>) => instanceSettingsInputSchema.safeParse(v).success;
  it('ages are never below 18; a maximum can be cleared', () => {
    expect(ok({ joinMinAge: 18 })).toBe(true);
    expect(ok({ joinMinAge: 17 })).toBe(false);
    expect(ok({ joinMaxAge: null })).toBe(true);
    expect(ok({ joinMaxAge: 10 })).toBe(false);
  });
  it('genders from the matching list, each once; a plain-text declaration', () => {
    expect(ok({ joinGenders: ['woman', 'nonbinary'] })).toBe(true);
    expect(ok({ joinGenders: ['woman', 'woman'] })).toBe(false);
    expect(ok({ joinGenders: ['trans_woman'] })).toBe(false);
    expect(ok({ joinDeclaration: 'I am single.' })).toBe(true);
    expect(ok({ joinDeclaration: '<script>' })).toBe(false);
    expect(ok({ joinDeclaration: 'x'.repeat(MAX_JOIN_DECLARATION + 1) })).toBe(false);
  });
});
