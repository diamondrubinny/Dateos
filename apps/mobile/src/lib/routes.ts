import type { MeResponse } from '@nexaheart/shared';

export const onboardingRoutes = {
  profile: '/onboarding/profile',
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
