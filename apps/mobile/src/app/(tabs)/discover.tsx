// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AccountNotices } from '../../components/AccountNotices';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { DecisionPanel, type DecisionResult } from '../../components/DecisionPanel';
import { Loading } from '../../components/Loading';
import { MatchCelebration } from '../../components/MatchCelebration';
import { Screen } from '../../components/Screen';
import { OnBreak } from '../../components/OnBreak';
import { useDiscover, useMe } from '../../lib/queries';
import { radius, spacing, useColors } from '../../lib/theme';

export default function Discover() {
  const { t } = useTranslation();
  const colors = useColors();
  const feed = useDiscover();
  const onBreak = Boolean(useMe().data?.pause);
  const [index, setIndex] = useState(0);
  const [matchedWith, setMatchedWith] = useState<string>();

  useEffect(() => setIndex(0), [feed.dataUpdatedAt]);

  if (onBreak) {
    return (
      <Screen title={t('discover.title')}>
        <AccountNotices />
        <OnBreak />
      </Screen>
    );
  }
  if (feed.isPending) return <Loading />;
  const profiles = feed.data ?? [];
  const current = profiles[index];

  const onDecided = (result: DecisionResult) => {
    if (result.matched && current) setMatchedWith(current.displayName);
    if (index + 1 >= profiles.length) void feed.refetch();
    else setIndex(index + 1);
  };

  return (
    <Screen title={t('discover.title')}>
      <AccountNotices />
      {feed.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {matchedWith ? (
        <MatchCelebration name={matchedWith} onClose={() => setMatchedWith(undefined)} />
      ) : null}
      {current ? (
        <DecisionPanel key={current.id} profile={current} onDecided={onDecided} />
      ) : (
        <View style={[styles.empty, { backgroundColor: colors.surface }]}>
          <AppText variant="heading" center>
            {t('discover.emptyTitle')}
          </AppText>
          <AppText variant="body" tone="muted" center>
            {t('discover.emptyBody')}
          </AppText>
          <Button
            variant="secondary"
            label={t('discover.adjust')}
            onPress={() => router.push('/preferences')}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { padding: spacing.xl, borderRadius: radius.lg, gap: spacing.md },
});
