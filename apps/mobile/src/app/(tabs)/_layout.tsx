import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Loading } from '../../components/Loading';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/queries';
import { routeFor } from '../../lib/routes';
import { useColors } from '../../lib/theme';

const icons = { discover: '✦', picks: '☀', likes: '♥', matches: '💬', profile: '☺' } as const;

export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useColors();
  const session = authClient.useSession();
  const me = useMe(Boolean(session.data));
  if (session.isPending || (session.data && me.isPending)) return <Loading />;
  if (!session.data) return <Redirect href="/welcome" />;
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
          minHeight: 60,
        },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
      }}
    >
      {(Object.keys(icons) as (keyof typeof icons)[]).map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
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
