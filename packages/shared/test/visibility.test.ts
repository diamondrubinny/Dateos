// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { pauseEndsAt, pauseInputSchema } from '../src/visibility.js';

describe('take a break', () => {
  const now = new Date('2026-10-22T10:00:00Z');
  it('ends after the chosen time, or never by itself', () => {
    expect(pauseEndsAt('24h', now)?.toISOString()).toBe('2026-10-23T10:00:00.000Z');
    expect(pauseEndsAt('3d', now)?.toISOString()).toBe('2026-10-25T10:00:00.000Z');
    expect(pauseEndsAt('7d', now)?.toISOString()).toBe('2026-10-29T10:00:00.000Z');
    expect(pauseEndsAt('indefinite', now)).toBeNull();
  });
  it('accepts only the offered durations', () => {
    expect(pauseInputSchema.safeParse({ duration: '3d' }).success).toBe(true);
    expect(pauseInputSchema.safeParse({ duration: '30d' }).success).toBe(false);
  });
});
