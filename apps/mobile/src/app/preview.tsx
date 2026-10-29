// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { HiddenReason } from '@nexaheart/shared';
import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { ProfileCard } from '../components/ProfileCard';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { useProfilePreview } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

/** Where each reason is fixed. */
const FIX: Record<HiddenReason, Href> = {
  onBreak: '/settings',
  incognito: '/settings',
  noPhoto: '/onboarding/photos?edit=1',
  noLocation: '/onboarding/location',
};

/** "See my profile as others do" (phase 44). */
function PreviewScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const preview = useProfilePreview();

  if (preview.isPending) return <Loading />;
  if (!preview.data) {
    return (
      <Screen back title={t('preview.title')}>
        <Banner tone="error" message={t('common.genericError')} />
      </Screen>
    );
  }
  const { profile, hidden, pendingPhotos } = preview.data;

  return (
    <Screen back title={t('preview.title')}>
      <AppText variant="body">{t('preview.intro')}</AppText>
      {hidden.length > 0 ? (
        <View
          testID="preview-hidden"
          style={[styles.hidden, { backgroundColor: colors.primarySoft }]}
        >
          <AppText variant="heading" accessibilityRole="header">
            {t('preview.hiddenTitle')}
          </AppText>
          {hidden.map((reason) => (
            <View key={reason} style={styles.reason}>
              <AppText variant="body">{t(`preview.hidden.${reason}`)}</AppText>
              <Button
                variant="secondary"
                label={t(`preview.fix.${reason}`)}
                onPress={() => router.push(FIX[reason])}
              />
            </View>
          ))}
        </View>
      ) : (
        <Banner tone="success" message={t('preview.visible')} />
      )}
      {pendingPhotos > 0 ? (
        <Banner tone="info" message={t('preview.pendingPhotos', { count: pendingPhotos })} />
      ) : null}
      <ProfileCard profile={profile} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hidden: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  reason: { gap: spacing.xs },
});

export default function Preview() {
  return (
    <RequireSession>
      <PreviewScreen />
    </RequireSession>
  );
}
