// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { FederatedProfile } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import {
  asPublicProfile,
  useFederatedDeck,
  useFederatedDecide,
  useFederatedStatus,
} from '../lib/federated-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { Loading } from './Loading';
import { ProfileCard } from './ProfileCard';

/**
 * Partner communities (phase 28b): people from communities this one is connected to, who chose to
 * take part. Only for members who joined too; the likes go to the other community.
 */
export function PartnersDeck() {
  const { t } = useTranslation();
  const colors = useColors();
  const status = useFederatedStatus();
  const joined = Boolean(status.data?.joined);
  const deck = useFederatedDeck(joined);
  const decide = useFederatedDecide();
  const [index, setIndex] = useState(0);
  const [matched, setMatched] = useState<string>();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => setIndex(0), [deck.dataUpdatedAt]);

  if (status.isPending) return <Loading />;
  if (!joined) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface }]} testID="partners-off">
        <AppText variant="heading">{t('partners.offTitle')}</AppText>
        <AppText variant="body" tone="muted">
          {t('partners.offBody', {
            names: status.data?.partners.map((p) => p.name).join(', ') ?? '',
          })}
        </AppText>
        <Button label={t('partners.learnMore')} onPress={() => router.push('/partners')} />
      </View>
    );
  }
  if (deck.isPending) return <Loading />;
  const people = deck.data ?? [];
  const current: FederatedProfile | undefined = people[index];

  const next = () => {
    setConfirmBlock(false);
    if (index + 1 >= people.length) void deck.refetch();
    else setIndex(index + 1);
  };
  const act = async (kind: 'like' | 'pass' | 'block') => {
    if (!current) return;
    setError(undefined);
    setMatched(undefined);
    try {
      const result = await decide.mutateAsync({
        partnerId: current.partnerId,
        alias: current.alias,
        kind,
      });
      if (result.matched) setMatched(current.displayName);
      next();
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 429) return setError(t('discover.limit'));
      if (e instanceof ApiRequestError && e.status === 502) {
        return setError(t('partners.unreachable', { community: current.community }));
      }
      setError(t('common.genericError'));
    }
  };

  return (
    <View style={styles.wrap} testID="partners-deck">
      {matched ? (
        <Banner tone="success" message={t('partners.matched', { name: matched })} />
      ) : null}
      {error ? <Banner tone="error" message={error} /> : null}
      {deck.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {current ? (
        <View style={styles.wrap} key={`${current.partnerId}:${current.alias}`}>
          <View style={[styles.from, { backgroundColor: colors.primarySoft }]}>
            <AppText variant="label" userContent>
              {t('partners.from', { community: current.community })}
            </AppText>
          </View>
          <ProfileCard profile={asPublicProfile(current)} />
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label={t('discover.pass')}
              hint={t('partners.passHint', { name: current.displayName })}
              disabled={decide.isPending}
              onPress={() => void act('pass')}
            />
            <Button
              label={t('discover.like')}
              hint={t('partners.likeHint', {
                name: current.displayName,
                community: current.community,
              })}
              loading={decide.isPending}
              onPress={() => void act('like')}
            />
          </View>
          {confirmBlock ? (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <AppText variant="body">
                {t('partners.blockConfirm', { name: current.displayName })}
              </AppText>
              <Button
                variant="danger"
                label={t('partners.blockYes')}
                onPress={() => void act('block')}
              />
              <Button
                variant="ghost"
                label={t('common.cancel')}
                onPress={() => setConfirmBlock(false)}
              />
            </View>
          ) : (
            <>
              <Button
                variant="ghost"
                label={t('partners.block', { name: current.displayName })}
                onPress={() => setConfirmBlock(true)}
              />
              <Button
                variant="dangerGhost"
                label={t('partners.report', { name: current.displayName })}
                onPress={() =>
                  router.push({
                    pathname: '/partner-report',
                    params: {
                      partnerId: current.partnerId,
                      alias: current.alias,
                      name: current.displayName,
                      community: current.community,
                      matched: '0',
                    },
                  })
                }
              />
            </>
          )}
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <AppText variant="heading" center>
            {t('partners.emptyTitle')}
          </AppText>
          <AppText variant="body" tone="muted" center>
            {t('partners.emptyBody')}
          </AppText>
          <Button
            variant="secondary"
            label={t('partners.settings')}
            onPress={() => router.push('/partners')}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { padding: spacing.xl, borderRadius: radius.lg, gap: spacing.md },
  from: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md },
  actions: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
});
