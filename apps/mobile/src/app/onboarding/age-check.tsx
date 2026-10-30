// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { keys } from '../../lib/queries';
import { useAgeCheck, useStartAgeCheck } from '../../lib/safety-queries';
import { radius, spacing, useColors } from '../../lib/theme';

/**
 * Phase 63: the community requires an age check. The member goes to the community's provider and
 * comes back here; only the result reaches this community (over 18 or not, the method, when).
 */
export default function AgeCheckStep() {
  const { t } = useTranslation();
  const colors = useColors();
  const client = useQueryClient();
  const start = useStartAgeCheck();
  // Back from the provider (the web app opens it in the same tab): wait for its result.
  const [waiting, setWaiting] = useState(true);
  const state = useAgeCheck(waiting);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (state.data?.status === 'passed' || state.data?.required === false) {
      void client.invalidateQueries({ queryKey: keys.me }).then(() => router.replace('/'));
    }
    if (state.data?.status === 'failed') setWaiting(false);
  }, [state.data, client]);

  const go = async () => {
    setError(undefined);
    try {
      const { url } = await start.mutateAsync();
      setWaiting(true);
      if (Platform.OS === 'web') window.location.assign(url);
      else await Linking.openURL(url);
    } catch {
      setError(t('common.genericError'));
    }
  };

  return (
    <Screen title={t('ageCheck.title')}>
      {error ? <Banner tone="error" message={error} /> : null}
      {state.data?.status === 'failed' ? (
        <Banner tone="error" message={t('ageCheck.failed')} />
      ) : null}
      <AppText variant="body">{t('ageCheck.why')}</AppText>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <AppText variant="label">{t('ageCheck.keptTitle')}</AppText>
        <AppText variant="body">{t('ageCheck.kept')}</AppText>
      </View>
      <Button label={t('ageCheck.start')} loading={start.isPending} onPress={() => void go()} />
      <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
        {t('ageCheck.waiting')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
});
