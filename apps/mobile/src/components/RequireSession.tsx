// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { authClient } from '../lib/auth-client';
import { Loading } from './Loading';

export function RequireSession({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  if (session.isPending) return <Loading />;
  if (!session.data) return <Redirect href="/welcome" />;
  return <>{children}</>;
}
