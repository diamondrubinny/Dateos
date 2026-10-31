// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  introductionOutcomes,
  type IntroductionOutcome,
  type ReceivedIntroduction,
} from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RemoteImage } from '../components/RemoteImage';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import {
  useAnswerIntroduction,
  useIntroductionOutcome,
  useMyIntroductions,
} from '../lib/introduction-queries';
import { radius, spacing, useColors } from '../lib/theme';

/** Phase 68a: introductions a community matchmaker sent me; each answer is private. */
function Introductions() {
  const { t } = useTranslation();
  const intros = useMyIntroductions();
  const [error, setError] = useState<string>();
  if (!intros.data) return <Loading />;
  const { received, matchmakerSince } = intros.data;
  return (
    <Screen back title={t('intro.title')}>
      <AppText variant="body">{t('intro.intro')}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {matchmakerSince ? (
        <Button label={t('console.title')} onPress={() => router.push('/matchmaking')} />
      ) : null}
      <Button
        variant="secondary"
        label={t('suggest.title')}
        onPress={() => router.push('/suggest-friends')}
      />
      {received.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('intro.empty')}
        </AppText>
      ) : (
        <View style={styles.list} role="list" accessibilityLabel={t('intro.title')}>
          {received.map((r) => (
            <IntroductionCard
              key={r.id}
              intro={r}
              onError={() => setError(t('common.genericError'))}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function IntroductionCard({
  intro,
  onError,
}: {
  intro: ReceivedIntroduction;
  onError: () => void;
}) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const answer = useAnswerIntroduction();
  const outcome = useIntroductionOutcome();
  const name = intro.other.displayName;
  const by = intro.matchmaker?.displayName ?? t('intro.someMatchmaker');
  const since = intro.matchmaker?.since
    ? new Date(intro.matchmaker.since).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
      })
    : null;
  const send = (a: 'yes' | 'no') => answer.mutate({ id: intro.id, answer: a }, { onError });
  return (
    <View
      role="listitem"
      testID="introduction"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <AppText variant="heading">{t('intro.cardTitle', { by, name })}</AppText>
      {/* Phase 68c: a friend who knows both, never with a matchmaker's badge. */}
      <AppText variant="caption" tone={since || intro.kind === 'friend' ? 'primary' : 'muted'}>
        {intro.kind === 'friend'
          ? `🤝 ${t('suggest.fromFriend', { name: by })}`
          : since
            ? `💌 ${t('intro.since', { date: since })}`
            : t('intro.notAnymore')}
      </AppText>
      <View style={[styles.note, { backgroundColor: colors.primarySoft }]}>
        <AppText variant="body" userContent>
          {intro.note}
        </AppText>
      </View>
      <View style={styles.person}>
        {intro.other.photoUrl ? (
          <RemoteImage path={intro.other.photoUrl} label={name} style={styles.thumb} />
        ) : null}
        <Button
          variant="secondary"
          label={t('intro.seeProfile', { name })}
          onPress={() => router.push(`/profile/${intro.other.id}`)}
        />
      </View>
      {intro.state === 'open' && intro.myAnswer === null ? (
        <>
          <AppText variant="caption" tone="muted">
            {t('intro.privateAnswer')}
          </AppText>
          <View style={styles.actions}>
            <Button label={t('intro.yes')} loading={answer.isPending} onPress={() => send('yes')} />
            <Button
              variant="ghost"
              label={t('intro.no')}
              disabled={answer.isPending}
              onPress={() => send('no')}
            />
          </View>
        </>
      ) : null}
      {intro.state === 'open' && intro.myAnswer === 'yes' ? (
        <AppText variant="body" accessibilityLiveRegion="polite">
          {t('intro.saidYes', { name })}
        </AppText>
      ) : null}
      {intro.state === 'closed' ? (
        <AppText variant="body" tone="muted">
          {intro.myAnswer === 'no' ? t('intro.saidNo') : t('intro.didntGoAhead')}
        </AppText>
      ) : null}
      {intro.state === 'matched' ? (
        <>
          <AppText variant="body" tone="success">
            {t('intro.matched', { name })}
          </AppText>
          {intro.matchId ? (
            <Button
              label={t('intro.openChat', { name })}
              onPress={() => router.push(`/chat/${intro.matchId}`)}
            />
          ) : null}
          <ChoiceGroup<IntroductionOutcome>
            label={t('intro.howItWent', { by })}
            options={introductionOutcomes.map((o) => ({
              value: o,
              label: t(`intro.outcome.${o}`),
            }))}
            selected={intro.outcome ? [intro.outcome] : []}
            onChange={([o]) => {
              if (o) outcome.mutate({ id: intro.id, outcome: o }, { onError });
            }}
          />
        </>
      ) : null}
    </View>
  );
}

export default function IntroductionsRoute() {
  return (
    <RequireSession>
      <Introductions />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  note: { borderRadius: radius.md, padding: spacing.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  actions: { gap: spacing.sm },
});
