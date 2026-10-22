// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Redirect, Stack } from 'expo-router';
import { Loading } from '../../components/Loading';
import { authClient } from '../../lib/auth-client';

export default function OnboardingLayout() {
  const session = authClient.useSession();
  if (session.isPending) return <Loading />;
  if (!session.data) return <Redirect href="/welcome" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
