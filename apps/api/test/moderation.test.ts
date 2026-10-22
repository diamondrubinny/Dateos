// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { reportPriority } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import { parseStaffArgs } from '../src/cli/staff.js';
import { createEmailHasher, normalizeEmail } from '../src/lib/banned.js';

describe('report triage', () => {
  it('puts possible minors and threats first', () => {
    expect(reportPriority('underage')).toBe('urgent');
    expect(reportPriority('threat')).toBe('urgent');
    expect(reportPriority('scam')).toBe('high');
    expect(reportPriority('harassment')).toBe('high');
    expect(reportPriority('spam')).toBe('normal');
  });
});

describe('banned email hashing', () => {
  it('normalises trivial variants', () => {
    expect(normalizeEmail('  Dan.Levi+dating@GoogleMail.com ')).toBe('danlevi@gmail.com');
    expect(normalizeEmail('dan.levi+x@example.org')).toBe('dan.levi@example.org');
  });

  it('is keyed: the same address hashes differently per instance secret', () => {
    const a = createEmailHasher('a'.repeat(40));
    const b = createEmailHasher('b'.repeat(40));
    expect(a('x@example.org')).toBe(a('X+1@example.org'));
    expect(a('x@example.org')).not.toBe(b('x@example.org'));
    expect(a('x@example.org')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('staff CLI arguments', () => {
  it('parses commands and rejects invalid roles', () => {
    expect(parseStaffArgs(['grant', 'a@b.test', 'admin'])).toEqual({
      kind: 'grant',
      email: 'a@b.test',
      role: 'admin',
    });
    expect(parseStaffArgs(['reset-mfa', 'a@b.test'])).toEqual({
      kind: 'reset-mfa',
      email: 'a@b.test',
    });
    expect(parseStaffArgs(['list'])).toEqual({ kind: 'list' });
    expect(() => parseStaffArgs(['grant', 'a@b.test', 'superuser'])).toThrow();
    expect(() => parseStaffArgs(['grant', 'nope'])).toThrow();
    expect(() => parseStaffArgs(['drop'])).toThrow();
  });
});
