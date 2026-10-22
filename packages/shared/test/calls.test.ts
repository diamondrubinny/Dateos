// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  callSummary,
  chatSettingsInputSchema,
  instanceSettingsInputSchema,
  startCallSchema,
} from '../src/index.js';

describe('calls', () => {
  it('summarises a call as plain text, rounding up to at least a minute', () => {
    expect(callSummary({ video: true, status: 'ended', durationSeconds: 14 * 60 + 20 })).toBe(
      'Video call: 14 min',
    );
    expect(callSummary({ video: false, status: 'ended', durationSeconds: 5 })).toBe(
      'Voice call: 1 min',
    );
    expect(callSummary({ video: true, status: 'missed', durationSeconds: null })).toBe(
      'Video call: missed',
    );
    expect(callSummary({ video: false, status: 'declined', durationSeconds: null })).toBe(
      'Voice call: declined',
    );
  });

  it('validates inputs', () => {
    expect(startCallSchema.safeParse({ video: true }).success).toBe(true);
    expect(startCallSchema.safeParse({}).success).toBe(false);
    expect(chatSettingsInputSchema.safeParse({ acceptCalls: false }).success).toBe(true);
    expect(chatSettingsInputSchema.safeParse({}).success).toBe(false);
    expect(instanceSettingsInputSchema.safeParse({ callMaxMinutes: 60 }).success).toBe(true);
    expect(instanceSettingsInputSchema.safeParse({ callMaxMinutes: 4 }).success).toBe(false);
    expect(instanceSettingsInputSchema.safeParse({ callMaxMinutes: 121 }).success).toBe(false);
  });
});
