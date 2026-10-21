import { Link, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Choice';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { authClient } from '../lib/auth-client';
import {
  useClearLocation,
  useDeleteAccount,
  useInstance,
  useMe,
  useSetConsents,
} from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

function SettingsContent() {
  const { t } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const instance = useInstance();
  const consents = useSetConsents();
  const deleteAccount = useDeleteAccount();
  const clearLocation = useClearLocation();
  const [locationRemoved, setLocationRemoved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const toggle = (kind: 'ai_cloud' | 'analytics', granted: boolean) =>
    consents.mutate([{ kind, granted, version: '1' }], {
      onError: () => setError(t('common.genericError')),
    });

  const signOut = async () => {
    await authClient.signOut();
    router.replace('/welcome');
  };

  const remove = async () => {
    try {
      await deleteAccount.mutateAsync();
      await authClient.signOut().catch(() => undefined);
      router.replace('/welcome');
    } catch {
      setError(t('common.genericError'));
    }
  };

  // App stores restrict donation links inside native apps, so sponsorship is offered on the web only.
  const sponsorUrl = Platform.OS === 'web' ? instance.data?.sponsorUrl : null;
  const linkStyle = [styles.link, { color: colors.primary }];

  return (
    <Screen back title={t('settings.title')}>
      {error ? <Banner tone="error" message={error} /> : null}
      {locationRemoved ? <Banner tone="info" message={t('settings.locationRemoved')} /> : null}
      <LanguageSwitch />
      <Button
        variant="secondary"
        label={t('settings.preferences')}
        onPress={() => router.push('/preferences')}
      />

      <AppText variant="heading">{t('settings.privacy')}</AppText>
      <Checkbox
        label={t('onboarding.consents.aiCloud')}
        hint={t('onboarding.consents.aiCloudHint')}
        checked={me.data?.consents.ai_cloud ?? false}
        onChange={(v) => toggle('ai_cloud', v)}
      />
      <Checkbox
        label={t('onboarding.consents.analytics')}
        hint={t('onboarding.consents.analyticsHint')}
        checked={me.data?.consents.analytics ?? false}
        onChange={(v) => toggle('analytics', v)}
      />

      {sponsorUrl ? (
        <View style={[styles.card, { backgroundColor: colors.primarySoft }]}>
          <AppText variant="heading" tone="primary">
            💜 {t('settings.support')}
          </AppText>
          <AppText variant="body">{t('settings.supportHint')}</AppText>
          <Button
            variant="primary"
            label={t('settings.support')}
            onPress={() => void WebBrowser.openBrowserAsync(sponsorUrl)}
          />
        </View>
      ) : null}

      <View style={styles.links}>
        <Link href="/accessibility" style={linkStyle}>
          {t('settings.accessibility')}
        </Link>
        <Link href="/terms" style={linkStyle}>
          {t('settings.terms')}
        </Link>
        <Link href="/privacy" style={linkStyle}>
          {t('settings.privacyPolicy')}
        </Link>
      </View>

      <Button
        variant="ghost"
        label={t('settings.removeLocation')}
        loading={clearLocation.isPending}
        onPress={() =>
          clearLocation.mutate(undefined, {
            onSuccess: () => setLocationRemoved(true),
            onError: () => setError(t('common.genericError')),
          })
        }
      />
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
      <AppText variant="caption" tone="muted" center>
        {t('settings.credit')}
      </AppText>
    </Screen>
  );
}

export default function Settings() {
  return (
    <RequireSession>
      <SettingsContent />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
  links: { gap: spacing.xs },
  link: {
    fontSize: 16,
    fontWeight: '600',
    textDecorationLine: 'underline',
    paddingVertical: spacing.sm,
  },
});
