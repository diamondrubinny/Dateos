// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { PairCard, PairMember } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import {
  createPairInvite,
  pairUrl,
  shareLink,
  useMyPair,
  usePairDecision,
  usePairsDiscover,
} from '../lib/friend-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { Loading } from './Loading';
import { RemoteImage } from './RemoteImage';

export function PairMemberTile({ member }: { member: PairMember }) {
  const colors = useColors();
  return (
    <View style={styles.member}>
      {member.photoUrl ? (
        <RemoteImage path={member.photoUrl} label={member.displayName} style={styles.photo} />
      ) : (
        <View style={[styles.photo, { backgroundColor: colors.surface }]} />
      )}
      <AppText variant="heading" userContent center>
        {member.displayName}, {member.age}
      </AppText>
    </View>
  );
}

/** Invite a friend to pair up for double dates: a one-time link, shared any way they like. */
export function PairInvite() {
  const { t } = useTranslation();
  const colors = useColors();
  const [link, setLink] = useState<string>();
  const [status, setStatus] = useState<'shared' | 'copied' | 'shown'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const invite = async () => {
    setBusy(true);
    setError(false);
    try {
      const { token } = await createPairInvite();
      const url = pairUrl(token);
      setLink(url);
      setStatus(await shareLink(url, t('pair.shareMessage')));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="pair-invite">
      <AppText variant="heading">{t('pair.title')}</AppText>
      <AppText variant="body" tone="muted">
        {t('pair.intro')}
      </AppText>
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {status === 'copied' ? <Banner tone="success" message={t('pair.copied')} /> : null}
      {link ? (
        <AppText variant="caption" selectable testID="pair-link" style={styles.link}>
          {link}
        </AppText>
      ) : null}
      <Button label={t('pair.invite')} loading={busy} onPress={() => void invite()} />
      <AppText variant="caption" tone="muted">
        {t('pair.linkHint')}
      </AppText>
    </View>
  );
}

/** Double dates (phase 22): other pairs all four of you may see; either friend decides. */
export function DoubleDeck() {
  const { t } = useTranslation();
  const colors = useColors();
  const pair = useMyPair();
  const deck = usePairsDiscover(Boolean(pair.data));
  const decide = usePairDecision();
  const [doubleId, setDoubleId] = useState<string>();
  const [error, setError] = useState(false);

  if (pair.isPending) return <Loading />;
  if (!pair.data) return <PairInvite />;
  if (deck.isPending) return <Loading />;
  const current: PairCard | undefined = deck.data?.[0];

  const choose = (kind: 'like' | 'pass') =>
    current &&
    decide.mutate(
      { id: current.id, kind },
      {
        onSuccess: (r) => r.doubleId && setDoubleId(r.doubleId),
        onError: () => setError(true),
      },
    );

  return (
    <View style={styles.wrap}>
      <AppText variant="body" tone="muted">
        {t('pair.withFriend', { name: pair.data.friend.displayName })}
      </AppText>
      {doubleId ? (
        <View style={[styles.card, { backgroundColor: colors.successSoft }]} testID="double-match">
          <AppText variant="heading" tone="success">
            {t('pair.doubleMatch')}
          </AppText>
          <Button
            label={t('pair.openChat')}
            onPress={() => router.push({ pathname: '/double/[id]', params: { id: doubleId } })}
          />
        </View>
      ) : null}
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {current ? (
        <View
          style={[styles.card, { backgroundColor: colors.surface }]}
          testID="pair-card"
          accessibilityRole="summary"
        >
          <View style={styles.members}>
            {current.members.map((m) => (
              <PairMemberTile key={m.id} member={m} />
            ))}
          </View>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label={`✕ ${t('discover.pass')}`}
              disabled={decide.isPending}
              onPress={() => choose('pass')}
            />
            <Button
              label={`♥ ${t('pair.like')}`}
              loading={decide.isPending && decide.variables?.kind === 'like'}
              onPress={() => choose('like')}
            />
          </View>
          <AppText variant="caption" tone="muted">
            {t('pair.decideHint', { name: pair.data.friend.displayName })}
          </AppText>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <AppText variant="heading" center>
            {t('pair.emptyTitle')}
          </AppText>
          <AppText variant="body" tone="muted" center>
            {t('pair.emptyBody')}
          </AppText>
        </View>
      )}
      <Button variant="ghost" label={t('pair.manage')} onPress={() => router.push('/pair')} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
  members: { flexDirection: 'row', gap: spacing.md },
  member: { flex: 1, gap: spacing.xs },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md },
  actions: { gap: spacing.sm },
  link: { writingDirection: 'ltr' },
});
