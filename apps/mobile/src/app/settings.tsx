// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { SENSITIVE_CONSENT_VERSION } from '@nexaheart/shared';
import { Link, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Choice';
import { DownloadData } from '../components/DownloadData';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { MoreOptions } from '../components/MoreOptions';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { authClient } from '../lib/auth-client';
import { useSetAcceptCalls } from '../lib/call-queries';
import { useChatSettings, useSetAcceptVoice } from '../lib/chat-queries';
import { useLocale } from '../lib/locale';
import { disablePush, enablePush, pushEnabledOnThisDevice } from '../lib/push';
import {
  useClearLocation,
  useDeleteAccount,
  useInstance,
  useMe,
  useSetConsents,
  useSetIncognito,
  useSetEventBadge,
  useSetMetBadge,
} from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { PoweredBy } from '../components/PoweredBy';
import { TakeABreak } from '../components/TakeABreak';
import { TravelMode } from '../components/TravelMode';
import { SecuritySettings } from '../components/SecuritySettings';

function SettingsContent() {
  const { t } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const instance = useInstance();
  const consents = useSetConsents();
  const deleteAccount = useDeleteAccount();
  const clearLocation = useClearLocation();
  const [locationRemoved, setLocationRemoved] = useState(false);
  const chatSettings = useChatSettings();
  const setAcceptVoice = useSetAcceptVoice();
  const setAcceptCalls = useSetAcceptCalls();
  const setIncognito = useSetIncognito();
  const setMetBadge = useSetMetBadge();
  const setEventBadge = useSetEventBadge();
  const { locale } = useLocale();
  const [push, setPush] = useState(false);
  const [pushNote, setPushNote] = useState<string>();
  useEffect(() => {
    void pushEnabledOnThisDevice().then(setPush);
  }, []);

  const togglePush = async (on: boolean) => {
    setPushNote(undefined);
    if (!on) {
      await disablePush();
      return setPush(false);
    }
    const result = await enablePush(locale).catch(() => 'error' as const);
    if (result === 'enabled') return setPush(true);
    setPushNote(t(`push.${result}`));
  };
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const toggle = (kind: 'ai_cloud' | 'analytics' | 'sensitive', granted: boolean) =>
    consents.mutate(
      [{ kind, granted, version: kind === 'sensitive' ? SENSITIVE_CONSENT_VERSION : '1' }],
      {
        onError: () => setError(t('common.genericError')),
      },
    );

  const signOut = async () => {
    await disablePush(); // this device should stop receiving this account's notifications
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
        label={t('display.title')}
        onPress={() => router.push('/display')}
      />
      <MoreOptions>
        <Button
          variant="secondary"
          label={t('settings.preferences')}
          onPress={() => router.push('/preferences')}
        />
        <Button
          variant="secondary"
          label={t('deal.title')}
          onPress={() => router.push('/dealbreakers')}
        />
        <Button
          variant="secondary"
          label={t('friends.modeTitle')}
          onPress={() => router.push('/friend-mode')}
        />
        <Button
          variant="secondary"
          label={me.data?.verified ? `✓ ${t('verify.approved')}` : t('verify.entry')}
          onPress={() => router.push('/verify')}
        />
      </MoreOptions>

      <AppText variant="heading">{t('settings.notifications')}</AppText>
      {Platform.OS === 'web' ? (
        <AppText variant="body" tone="muted">
          {t('push.unsupported')}
        </AppText>
      ) : (
        <Checkbox
          label={t('push.label')}
          hint={t('push.hint')}
          checked={push}
          onChange={(v) => void togglePush(v)}
        />
      )}
      {pushNote ? <Banner tone="info" message={pushNote} /> : null}
      <Checkbox
        label={t('voice.acceptLabel')}
        hint={t('voice.acceptHint')}
        checked={chatSettings.data?.acceptVoice ?? true}
        onChange={(v) =>
          setAcceptVoice.mutate(v, { onError: () => setError(t('common.genericError')) })
        }
      />
      {instance.data?.calls ? (
        <Checkbox
          label={t('call.acceptLabel')}
          hint={t('call.acceptHint')}
          checked={chatSettings.data?.acceptCalls ?? true}
          onChange={(v) =>
            setAcceptCalls.mutate(v, { onError: () => setError(t('common.genericError')) })
          }
        />
      ) : null}

      <MoreOptions>
        <AppText variant="heading">{t('visibility.title')}</AppText>
        <Checkbox
          label={t('visibility.incognitoLabel')}
          hint={t('visibility.incognitoHint')}
          checked={me.data?.incognito ?? false}
          onChange={(v) =>
            setIncognito.mutate(v, { onError: () => setError(t('common.genericError')) })
          }
        />
        <Checkbox
          label={t('visibility.metBadgeLabel')}
          hint={t('visibility.metBadgeHint')}
          checked={me.data?.showMetBadge ?? false}
          onChange={(v) =>
            setMetBadge.mutate(v, { onError: () => setError(t('common.genericError')) })
          }
        />
        <Checkbox
          label={t('visibility.eventBadgeLabel')}
          hint={t('visibility.eventBadgeHint')}
          checked={me.data?.showEventBadge ?? false}
          onChange={(v) =>
            setEventBadge.mutate(v, { onError: () => setError(t('common.genericError')) })
          }
        />
        <TakeABreak />
        <TravelMode />

        <SecuritySettings />
      </MoreOptions>

      <AppText variant="heading">{t('settings.privacy')}</AppText>
      <Checkbox
        label={t('settings.sensitiveLabel')}
        hint={t('settings.sensitiveHint')}
        checked={me.data?.consents.sensitive ?? false}
        onChange={(v) => toggle('sensitive', v)}
      />
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
      <DownloadData />

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
        <Link href="/cookies" style={linkStyle}>
          {t('settings.cookies')}
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
      <PoweredBy />
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
