// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useFriendMode, useFriendsDiscover } from '../lib/friend-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { DecisionPanel, type DecisionResult } from './DecisionPanel';
import { Loading } from './Loading';

/** Friends mode (phase 22): its own deck, only people who turned it on too. */
export function FriendsDeck() {
  const { t } = useTranslation();
  const colors = useColors();
  const mode = useFriendMode();
  const on = Boolean(mode.data?.on);
  const deck = useFriendsDiscover(on);
  const [index, setIndex] = useState(0);
  const [matched, setMatched] = useState<string>();

  useEffect(() => setIndex(0), [deck.dataUpdatedAt]);

  if (mode.isPending) return <Loading />;
  if (!on) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface }]} testID="friends-off">
        <AppText variant="heading">{t('friends.offTitle')}</AppText>
        <AppText variant="body" tone="muted">
          {t('friends.offBody')}
        </AppText>
        <Button label={t('friends.turnOn')} onPress={() => router.push('/friend-mode')} />
      </View>
    );
  }
  if (deck.isPending) return <Loading />;
  const people = deck.data ?? [];
  const current = people[index];
  const onDecided = (result: DecisionResult) => {
    if (result.matched && current) setMatched(current.displayName);
    if (index + 1 >= people.length) void deck.refetch();
    else setIndex(index + 1);
  };

  return (
    <View style={styles.wrap}>
      {matched ? <Banner tone="success" message={t('friends.matched', { name: matched })} /> : null}
      {current ? (
        <DecisionPanel key={current.id} profile={current} mode="friend" onDecided={onDecided} />
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <AppText variant="heading" center>
            {t('friends.emptyTitle')}
          </AppText>
          <AppText variant="body" tone="muted" center>
            {t('friends.emptyBody')}
          </AppText>
          <Button
            variant="secondary"
            label={t('friends.settings')}
            onPress={() => router.push('/friend-mode')}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { padding: spacing.xl, borderRadius: radius.lg, gap: spacing.md },
});
