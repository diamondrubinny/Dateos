// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { VisibilityCode, VisibilityItem } from '@nexaheart/shared';
import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { useMyVisibility } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

/** Where each limit is lifted (none: it waits on the moderators). */
const FIX: Record<VisibilityCode, Href | null> = {
  on_break: '/settings',
  incognito: '/settings',
  no_photo: '/onboarding/photos?edit=1',
  no_location: '/onboarding/location',
  pending_review: null,
  like_limit: '/settings',
  verified_only: '/settings',
  unanswered: '/matches',
};

/**
 * "My visibility" (phase 70): whether new people can find me and, if not fully, every reason and
 * what lifts it. Nothing limits a member's visibility without being listed here.
 */
function MyVisibilityScreen() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const visibility = useMyVisibility();

  if (visibility.isPending) return <Loading />;
  if (!visibility.data) {
    return (
      <Screen back title={t('myVisibility.title')}>
        <Banner tone="error" message={t('common.genericError')} />
      </Screen>
    );
  }
  const { visible, items } = visibility.data;
  const hidden = items.filter((i) => i.hides);
  const fewer = items.filter((i) => !i.hides);
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' });
  const text = (item: VisibilityItem) =>
    item.code === 'on_break' && item.until
      ? t('myVisibility.item.on_break_until', { date: when(item.until) })
      : t(`myVisibility.item.${item.code}`, { count: item.count ?? 0 });

  const list = (title: string, group: VisibilityItem[], testID: string) =>
    group.length > 0 ? (
      <View testID={testID} style={[styles.group, { backgroundColor: colors.primarySoft }]}>
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
        <View role="list" style={styles.list}>
          {group.map((item) => {
            const fix = FIX[item.code];
            return (
              <View key={item.code} role="listitem" style={styles.item} testID={`vis-${item.code}`}>
                <AppText variant="body">{text(item)}</AppText>
                {fix ? (
                  <Button
                    variant="secondary"
                    label={t(
                      `myVisibility.fix.${item.code as Exclude<VisibilityCode, 'pending_review'>}`,
                    )}
                    onPress={() => router.push(fix)}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    ) : null;

  return (
    <Screen back title={t('myVisibility.title')}>
      <AppText variant="body">{t('myVisibility.intro')}</AppText>
      {visible ? (
        <View testID="vis-visible">
          <Banner tone="success" message={t('myVisibility.visible')} />
        </View>
      ) : null}
      {list(t('myVisibility.hiddenTitle'), hidden, 'vis-hidden')}
      {list(t('myVisibility.fewerTitle'), fewer, 'vis-fewer')}
      <AppText variant="caption" tone="muted">
        {t('myVisibility.private')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  list: { gap: spacing.md },
  item: { gap: spacing.xs },
});

export default function MyVisibility() {
  return (
    <RequireSession>
      <MyVisibilityScreen />
    </RequireSession>
  );
}
