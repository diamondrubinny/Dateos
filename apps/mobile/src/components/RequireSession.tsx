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
