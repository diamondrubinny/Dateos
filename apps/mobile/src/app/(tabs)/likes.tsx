// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { LikeReceived } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { PersonRow } from '../../components/PersonRow';
import { Screen } from '../../components/Screen';
import { OnBreak } from '../../components/OnBreak';
import { useLikes, useMe, useRemoveSaved, useSaved } from '../../lib/queries';
import { StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { spacing } from '../../lib/theme';

export default function Likes() {
  const { t } = useTranslation();
  const likes = useLikes();
  const saved = useSaved();
  const remove = useRemoveSaved();
  const onBreak = Boolean(useMe().data?.pause);
  if (onBreak) {
    return (
      <Screen title={t('likes.title')} subtitle={t('likes.subtitle')}>
        <OnBreak />
      </Screen>
    );
  }
  if (likes.isPending) return <Loading />;

  const describe = (like: LikeReceived) => {
    if (like.itemType === 'photo') return t('likes.likedPhoto');
    if (like.promptKey) return t('likes.likedPrompt', { prompt: t(`prompt.${like.promptKey}`) });
    return t('likes.likedProfile');
  };

  return (
    <Screen title={t('likes.title')} subtitle={t('likes.subtitle')}>
      {likes.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {likes.data?.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('likes.empty')}
        </AppText>
      ) : null}
      {likes.data?.map((like) => (
        <PersonRow
          key={like.profile.id}
          profile={like.profile}
          detail={describe(like)}
          quote={like.comment}
          onPress={() => router.push(`/profile/${like.profile.id}`)}
        />
      ))}
      {/* "Maybe later" (phase 33): put aside in Discover, decided from the profile. */}
      {saved.data && saved.data.length > 0 ? (
        <View style={styles.section} testID="maybe-later">
          <AppText variant="heading">{t('later.title')}</AppText>
          <AppText variant="caption" tone="muted">
            {t('later.intro')}
          </AppText>
          {saved.data.map((profile) => (
            <View key={profile.id} style={styles.saved}>
              <PersonRow profile={profile} onPress={() => router.push(`/profile/${profile.id}`)} />
              <Button
                variant="ghost"
                label={t('later.remove')}
                hint={profile.displayName}
                loading={remove.isPending && remove.variables === profile.id}
                onPress={() => remove.mutate(profile.id)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.lg },
  saved: { gap: 2 },
});
