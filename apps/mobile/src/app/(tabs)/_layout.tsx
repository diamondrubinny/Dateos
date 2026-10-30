// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Loading } from '../../components/Loading';
import { authClient } from '../../lib/auth-client';
import { useDisplay } from '../../lib/display';
import { useMe } from '../../lib/queries';
import { routeFor } from '../../lib/routes';
import { useColors } from '../../lib/theme';
import { NoSession } from '../../components/ServerUnreachable';

const icons = { discover: '✦', picks: '☀', likes: '♥', matches: '💬', profile: '☺' } as const;
/** Easy mode (phase 25): three tabs; Picks and Likes open from Discover instead. */
const EASY_HIDDEN = new Set<keyof typeof icons>(['picks', 'likes']);

export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useColors();
  const { easy } = useDisplay();
  const session = authClient.useSession();
  const me = useMe(Boolean(session.data));
  if (session.isPending || (session.data && me.isPending)) return <Loading />;
  if (!session.data) return <NoSession error={session.error} onRetry={session.refetch} />;
  if (me.data && routeFor(me.data) !== '/discover') return <Redirect href={routeFor(me.data)} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          minHeight: easy ? 72 : 60,
        },
        tabBarLabelStyle: { fontSize: easy ? 16 : 13, fontWeight: '600' },
      }}
    >
      {(Object.keys(icons) as (keyof typeof icons)[]).map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            ...(easy && EASY_HIDDEN.has(name) ? { href: null } : {}),
            title: t(`tabs.${name}`),
            tabBarAccessibilityLabel: t(`tabs.${name}`),
            tabBarIcon: ({ color }) => (
              <AppText
                variant="heading"
                style={{ color }}
                importantForAccessibility="no"
                accessibilityElementsHidden
              >
                {icons[name]}
              </AppText>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
