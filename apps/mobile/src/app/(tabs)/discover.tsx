// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import type { PublicProfile } from '@nexaheart/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AccountNotices } from '../../components/AccountNotices';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { DecisionPanel, type DecisionResult } from '../../components/DecisionPanel';
import { DoubleDeck } from '../../components/DoubleDeck';
import { FriendsDeck } from '../../components/FriendsDeck';
import { PartnersDeck } from '../../components/PartnersDeck';
import { Loading } from '../../components/Loading';
import { UndoPass } from '../../components/UndoPass';
import { MatchCelebration } from '../../components/MatchCelebration';
import { Screen } from '../../components/Screen';
import { OnBreak } from '../../components/OnBreak';
import { ReviewBanner } from '../../components/ReviewBanner';
import { travelLine } from '../../components/TravelMode';
import { useDisplay } from '../../lib/display';
import { useFederatedStatus } from '../../lib/federated-queries';
import { useLocale } from '../../lib/locale';
import { useDiscover, useMe, useTravel, useYourTurn } from '../../lib/queries';
import { radius, spacing, useColors } from '../../lib/theme';

export default function Discover() {
  const { t } = useTranslation();
  const colors = useColors();
  const feed = useDiscover();
  const onBreak = Boolean(useMe().data?.pause);
  const travel = useTravel();
  const yourTurn = useYourTurn();
  const { locale } = useLocale();
  const { easy } = useDisplay();
  const [index, setIndex] = useState(0);
  const [matchedWith, setMatchedWith] = useState<string>();
  // Easy mode: confirm each like in words, so nothing happens silently.
  const [liked, setLiked] = useState<string>();
  // Undo a pass (phase 29b): who was just passed on, and a profile brought back.
  const [passed, setPassed] = useState<string>();
  const [restored, setRestored] = useState<PublicProfile>();
  // Dating, friends (phase 22) or double dates (phase 22).
  // ...and, when this community has partners, people from partner communities (phase 28b).
  const [deck, setDeck] = useState<'date' | 'friend' | 'double' | 'partners'>('date');
  const partners = Boolean(useFederatedStatus().data?.available);

  useEffect(() => setIndex(0), [feed.dataUpdatedAt]);

  if (onBreak) {
    return (
      <Screen title={t('discover.title')}>
        <AccountNotices />
        <ReviewBanner />
        <OnBreak />
      </Screen>
    );
  }
  // Easy mode (phase 25): dating only, with Picks and Likes as plain buttons instead of tabs.
  const deckSwitch = easy ? (
    <View style={styles.easyLinks}>
      <Button
        variant="secondary"
        label={`${t('tabs.picks')} ☀`}
        hint={t('display.picksHint')}
        onPress={() => router.push('/picks')}
      />
      <Button
        variant="secondary"
        label={`${t('tabs.likes')} ♥`}
        hint={t('display.likesHint')}
        onPress={() => router.push('/likes')}
      />
    </View>
  ) : (
    <ChoiceGroup
      label={t('friends.deck')}
      options={[
        ...(['date', 'friend', 'double'] as const).map((value) => ({
          value,
          label: t(`friends.decks.${value}`),
        })),
        ...(partners ? [{ value: 'partners' as const, label: t('partners.deck') }] : []),
      ]}
      selected={[deck]}
      onChange={([v]) => v && setDeck(v)}
    />
  );
  if (deck !== 'date' && !easy) {
    return (
      <Screen title={t('discover.title')}>
        <AccountNotices />
        <ReviewBanner />
        {deckSwitch}
        {deck === 'friend' ? (
          <FriendsDeck />
        ) : deck === 'partners' ? (
          <PartnersDeck />
        ) : (
          <DoubleDeck />
        )}
      </Screen>
    );
  }
  if (feed.isPending) return <Loading />;
  const profiles = feed.data ?? [];
  const current = restored ?? profiles[index];

  const onDecided = (result: DecisionResult) => {
    if (result.matched && current) setMatchedWith(current.displayName);
    setLiked(easy && result.kind === 'like' && !result.matched ? current?.displayName : undefined);
    setPassed(result.kind === 'pass' ? current?.displayName : undefined);
    // A profile brought back by Undo sits in front of the deck; the deck itself didn't move.
    if (restored) return setRestored(undefined);
    if (index + 1 >= profiles.length) void feed.refetch();
    else setIndex(index + 1);
  };

  return (
    <Screen title={t('discover.title')}>
      <AccountNotices />
      <ReviewBanner />
      {deckSwitch}
      {travel.data ? <Banner tone="info" message={travelLine(travel.data, locale, t)} /> : null}
      {feed.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {yourTurn.data && yourTurn.data.waiting >= yourTurn.data.limit ? (
        <View
          testID="your-turn"
          style={[styles.focus, { backgroundColor: colors.primarySoft }]}
          accessibilityRole="summary"
        >
          <AppText variant="heading">{t('focus.title')}</AppText>
          <AppText variant="body">{t('focus.body', { count: yourTurn.data.waiting })}</AppText>
          <Button label={t('focus.open')} onPress={() => router.push('/matches')} />
        </View>
      ) : null}
      {liked ? (
        <Banner
          tone="info"
          message={t('display.likedSent', { name: liked, tab: t('tabs.matches') })}
        />
      ) : null}
      {matchedWith ? (
        <MatchCelebration name={matchedWith} onClose={() => setMatchedWith(undefined)} />
      ) : null}
      {current ? (
        <DecisionPanel key={current.id} profile={current} onDecided={onDecided} allowLater />
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
      {passed && !restored ? (
        <UndoPass
          key={passed}
          name={passed}
          onRestored={(profile) => {
            setRestored(profile);
            setPassed(undefined);
          }}
          onGone={() => setPassed(undefined)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { padding: spacing.xl, borderRadius: radius.lg, gap: spacing.md },
  easyLinks: { gap: spacing.sm },
  focus: { padding: spacing.md, borderRadius: radius.lg, gap: spacing.sm },
});
