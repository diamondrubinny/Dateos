import '../i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider as RouterLocaleProvider, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiRequestError } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { LocaleProvider, useLocale } from '../lib/locale';
import { RealtimeProvider } from '../lib/realtime';
import { useInstance } from '../lib/queries';
import { useColors } from '../lib/theme';

function Navigator() {
  const { direction } = useLocale();
  const colors = useColors();
  const session = authClient.useSession();
  const name = useInstance().data?.name;
  useEffect(() => {
    // Browser tab and bookmarks show the community's own name.
    if (Platform.OS === 'web' && name) document.title = name;
  }, [name]);
  return (
    <RouterLocaleProvider direction={direction}>
      <RealtimeProvider enabled={Boolean(session.data)}>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </RealtimeProvider>
    </RouterLocaleProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Never retry auth/validation failures; retry transient errors twice.
            retry: (count, error) =>
              !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) &&
              count < 2,
          },
        },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <Navigator />
        </LocaleProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
