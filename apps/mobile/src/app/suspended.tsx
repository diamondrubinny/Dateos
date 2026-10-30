// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { clearDrafts } from '../lib/drafts';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AccountDecisions } from '../components/AccountDecisions';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { DownloadData } from '../components/DownloadData';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { authClient } from '../lib/auth-client';
import { useDeleteAccount } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { PoweredBy } from '../components/PoweredBy';

/**
 * Suspended members can read why and appeal (phase 61), download their data (right of access) and
 * delete their account (right to erasure), nothing else.
 */
function SuspendedScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const deleteAccount = useDeleteAccount();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const signOut = async () => {
    await clearDrafts(); // a shared device keeps no drafts (phase 38)
    await authClient.signOut().catch(() => undefined);
    router.replace('/welcome');
  };
  const remove = async () => {
    try {
      await deleteAccount.mutateAsync();
      await signOut();
    } catch {
      setError(t('common.genericError'));
    }
  };

  return (
    <Screen title={t('account.suspendedTitle')}>
      {error ? <Banner tone="error" message={error} /> : null}
      <AppText variant="body">{t('account.suspendedBody')}</AppText>
      {/* Phase 61: why, and the appeal. An age suspension has no moderation decision. */}
      <AccountDecisions emptyText={t('account.suspendedAge')} />
      <AppText variant="body">{t('account.suspendedAppeal')}</AppText>
      <DownloadData />
      <Button variant="ghost" label={t('settings.signOut')} onPress={() => void signOut()} />
      {confirming ? (
        <View
          style={[styles.card, { backgroundColor: colors.dangerSoft }]}
          accessibilityRole="alert"
        >
          <AppText variant="heading" tone="danger">
            {t('settings.deleteConfirmTitle')}
          </AppText>
          <AppText variant="body">{t('settings.deleteConfirmBody')}</AppText>
          <Button
            variant="danger"
            label={t('settings.deleteConfirm')}
            loading={deleteAccount.isPending}
            onPress={() => void remove()}
          />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <Button
          variant="dangerGhost"
          label={t('settings.deleteAccount')}
          onPress={() => setConfirming(true)}
        />
      )}
      <PoweredBy />
    </Screen>
  );
}

export default function SuspendedRoute() {
  return (
    <RequireSession>
      <SuspendedScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
});
