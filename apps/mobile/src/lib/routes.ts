import type { MeResponse } from '@dateos/shared';

export const onboardingRoutes = {
  profile: '/onboarding/profile',
  consents: '/onboarding/consents',
  photos: '/onboarding/photos',
  prompts: '/onboarding/prompts',
} as const;

export const ONBOARDING_TOTAL = 4;

/** Where a signed-in user belongs: the first missing onboarding step, otherwise home. */
export function routeFor(
  me: MeResponse,
): (typeof onboardingRoutes)[keyof typeof onboardingRoutes] | '/home' {
  const first = me.onboarding.missing[0];
  return first ? onboardingRoutes[first] : '/home';
}
