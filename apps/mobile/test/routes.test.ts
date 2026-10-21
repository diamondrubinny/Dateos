import type { MeResponse } from '@dateos/shared';
import { describe, expect, it } from 'vitest';
import { routeFor } from '../src/lib/routes';

const me = (missing: MeResponse['onboarding']['missing']) =>
  ({ onboarding: { complete: missing.length === 0, missing } }) as MeResponse;

describe('routeFor', () => {
  it('sends users to the first missing onboarding step', () => {
    expect(routeFor(me(['profile', 'consents', 'photos', 'prompts']))).toBe('/onboarding/profile');
    expect(routeFor(me(['photos', 'prompts']))).toBe('/onboarding/photos');
  });

  it('sends onboarded users to discovery', () => {
    expect(routeFor(me([]))).toBe('/discover');
  });
});
