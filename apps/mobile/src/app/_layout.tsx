// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import '../i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider as RouterLocaleProvider, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiRequestError } from '../lib/api';
import { useAppBadge } from '../lib/app-badge';
import { authClient } from '../lib/auth-client';
import { DisplayProvider } from '../lib/display';
import { LocaleProvider, useLocale } from '../lib/locale';
import { registerServiceWorker } from '../lib/pwa';
import { RealtimeProvider } from '../lib/realtime';
import { WebIntegrations } from '../components/WebIntegrations';
import { IncomingCall } from '../components/IncomingCall';
import { AppLockGate } from '../components/AppLockGate';
import { ServerStatusBanner } from '../components/ServerStatusBanner';
import { useInstance } from '../lib/queries';
import { useColors } from '../lib/theme';

function Navigator() {
  const { direction } = useLocale();
  const colors = useColors();
  const session = authClient.useSession();
  // Phase 72: the number on the installed app's icon, wherever the member is in the app.
  useAppBadge(Boolean(session.data));
  const instanceInfo = useInstance().data;
  // Phase 67b: a discreet app shows its neutral name and a plain icon in the browser tab too.
  const name = instanceInfo?.discreetName ?? instanceInfo?.name;
  const discreet = Boolean(instanceInfo?.discreetName);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Tapping a notification opens the conversation (the payload carries only the match id).
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        type?: unknown;
        matchId?: unknown;
      };
      if (data.type === 'checkin') {
        router.push('/checkin');
      } else if (
        data.type === 'event' &&
        typeof data.matchId === 'string' &&
        /^[0-9a-f-]{36}$/.test(data.matchId)
      ) {
        router.push({ pathname: '/events/[id]', params: { id: data.matchId } });
      } else if (
        data.type === 'partner_message' &&
        typeof data.matchId === 'string' &&
        /^[0-9a-f-]{36}$/.test(data.matchId)
      ) {
        router.push({ pathname: '/partner-chat/[id]', params: { id: data.matchId } });
      } else if (typeof data.matchId === 'string' && /^[0-9a-f-]{36}$/.test(data.matchId)) {
        router.push({ pathname: '/chat/[id]', params: { id: data.matchId } });
      }
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    // Browser tab and bookmarks show the community's own name.
    if (Platform.OS === 'web' && name) document.title = name;
  }, [name]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !discreet) return;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = '/brand-icons/icon-192.png?v=discreet';
  }, [discreet]);
  const webDir = (Platform.OS === 'web' ? { dir: direction } : {}) as object;
  return (
    <RouterLocaleProvider direction={direction}>
      <RealtimeProvider enabled={Boolean(session.data)}>
        <StatusBar style="auto" />
        {session.data ? <IncomingCall /> : null}
        <WebIntegrations signedIn={Boolean(session.data)} />
        {/* On the web `textAlign: start` follows the nearest `dir`: set it once for every screen
            (chat and call screens don't use <Screen>). Native direction comes from I18nManager. */}
        <View style={styles.root} {...webDir}>
          {/* Phase 67a: a lock code set on this device hides everything until it's entered. */}
          <AppLockGate>
            {/* Signed out or not yet known, the session gates show the full "can't be reached". */}
            {session.data ? <ServerStatusBanner /> : null}
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            />
          </AppLockGate>
        </View>
      </RealtimeProvider>
    </RouterLocaleProvider>
  );
}

export default function RootLayout() {
  useEffect(registerServiceWorker, []);
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
          <DisplayProvider>
            <Navigator />
          </DisplayProvider>
        </LocaleProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
