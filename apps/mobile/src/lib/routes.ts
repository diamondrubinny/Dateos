// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { MeResponse } from '@nexaheart/shared';

export const onboardingRoutes = {
  profile: '/onboarding/profile',
  /** Phase 63: only where the community requires an age check. */
  age_check: '/onboarding/age-check',
  consents: '/onboarding/consents',
  photos: '/onboarding/photos',
  prompts: '/onboarding/prompts',
  location: '/onboarding/location',
} as const;

export const ONBOARDING_TOTAL = 5;

/**
 * Where a signed-in user belongs: the suspension notice, the first missing onboarding step,
 * otherwise discovery.
 */
export function routeFor(
  me: MeResponse,
): (typeof onboardingRoutes)[keyof typeof onboardingRoutes] | '/discover' | '/suspended' {
  if (me.user?.status === 'suspended') return '/suspended';
  const first = me.onboarding.missing[0];
  return first ? onboardingRoutes[first] : '/discover';
}
