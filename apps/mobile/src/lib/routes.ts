import type { MeResponse } from '@dateos/shared';

export const onboardingRoutes = {
  profile: '/onboarding/profile',
  consents: '/onboarding/consents',
  photos: '/onboarding/photos',
  prompts: '/onboarding/prompts',
  location: '/onboarding/location',
} as const;

export const ONBOARDING_TOTAL = 5;

/** Where a signed-in user belongs: the first missing onboarding step, otherwise discovery. */
export function routeFor(
  me: MeResponse,
): (typeof onboardingRoutes)[keyof typeof onboardingRoutes] | '/discover' {
  const first = me.onboarding.missing[0];
  return first ? onboardingRoutes[first] : '/discover';
}
