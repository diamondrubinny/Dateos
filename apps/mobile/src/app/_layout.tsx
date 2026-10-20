import '../i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider as RouterLocaleProvider, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiRequestError } from '../lib/api';
import { LocaleProvider, useLocale } from '../lib/locale';
import { useColors } from '../lib/theme';

function Navigator() {
  const { direction } = useLocale();
  const colors = useColors();
  return (
    <RouterLocaleProvider direction={direction}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      />
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
