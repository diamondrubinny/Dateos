import { Redirect, Stack } from 'expo-router';
import { Loading } from '../../components/Loading';
import { authClient } from '../../lib/auth-client';

export default function OnboardingLayout() {
  const session = authClient.useSession();
  if (session.isPending) return <Loading />;
  if (!session.data) return <Redirect href="/welcome" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
