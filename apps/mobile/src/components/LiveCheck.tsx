// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useLiveness, useStartLiveness } from '../lib/liveness-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

/**
 * Phase 69: "A quick live check" at the community's provider, before the human check. Says what
 * the provider gets (a live face and the first profile photo) and what comes back (only the
 * result).
 */
export function LiveCheck() {
  const { t } = useTranslation();
  const colors = useColors();
  const state = useLiveness();
  const start = useStartLiveness();
  const [error, setError] = useState<string>();
  if (!state.data?.available) return null;
  const last = state.data.last;

  const go = async () => {
    setError(undefined);
    try {
      const { url } = await start.mutateAsync();
      if (Platform.OS === 'web') window.location.assign(url);
      else await Linking.openURL(url);
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 409
          ? t('verify.needPhoto')
          : t('common.genericError'),
      );
    }
  };

  return (
    <View
      testID="live-check"
      style={[styles.box, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
    >
      <AppText variant="heading" tone="primary">
        {t('liveness.title')}
      </AppText>
      <AppText variant="body">{t('liveness.intro')}</AppText>
      <AppText variant="caption">{t('liveness.privacy')}</AppText>
      {last && last.result !== 'passed' ? (
        <Banner tone="info" message={t(`liveness.result.${last.result}`)} />
      ) : null}
      {error ? <Banner tone="error" message={error} /> : null}
      <Button label={t('liveness.start')} loading={start.isPending} onPress={() => void go()} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
});
