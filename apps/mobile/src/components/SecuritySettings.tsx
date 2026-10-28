// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { useInstance } from '../lib/queries';
import { screenCaptureBlocked } from '../lib/screen-capture';
import { radius, spacing, useColors } from '../lib/theme';
import {
  passkeysSupported,
  useAddPasskey,
  useCreateInvite,
  useMyInvites,
  usePasskeys,
  useRemovePasskey,
} from '../lib/trust-queries';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { Checkbox } from './Choice';
import { useChatSettings, useSetSigninAlerts } from '../lib/chat-queries';
import { AccountActivity } from './AccountActivity';
import { SignedInDevices } from './SignedInDevices';

/**
 * Settings → Security (phase 21): passkeys, your devices (phase 29), hide me from my contacts,
 * screenshots, invites.
 */
export function SecuritySettings() {
  const { t } = useTranslation();
  const colors = useColors();
  const instance = useInstance();
  const canPasskey = Boolean(instance.data?.auth.passkey) && passkeysSupported();
  const passkeys = usePasskeys(canPasskey);
  const add = useAddPasskey();
  const remove = useRemovePasskey();
  const invites = useMyInvites();
  const createInvite = useCreateInvite();
  const [error, setError] = useState<string>();
  const [newCode, setNewCode] = useState<string>();
  const chatSettings = useChatSettings();
  const setSigninAlerts = useSetSigninAlerts();

  const deviceName = () => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return t('passkey.thisDevice');
    const ua = navigator.userAgent;
    const os = /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Linux';
    return t('passkey.nameOn', { os });
  };

  return (
    <View style={styles.wrap}>
      <AppText variant="heading">{t('security.title')}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}

      {canPasskey ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]} testID="passkeys">
          <AppText variant="label">{t('passkey.title')}</AppText>
          <AppText variant="caption" tone="muted">
            {t('passkey.intro')}
          </AppText>
          {(passkeys.data ?? []).map((p) => (
            <View key={p.id} style={styles.row}>
              <AppText variant="body" style={styles.grow}>
                🔑 {p.name ?? t('passkey.unnamed')}
              </AppText>
              <Button
                variant="dangerGhost"
                label={t('passkey.remove')}
                hint={p.name ?? t('passkey.unnamed')}
                loading={remove.isPending && remove.variables === p.id}
                onPress={() =>
                  remove.mutate(p.id, { onError: () => setError(t('common.genericError')) })
                }
              />
            </View>
          ))}
          <Button
            variant="secondary"
            label={t('passkey.add')}
            loading={add.isPending}
            onPress={() => {
              setError(undefined);
              add.mutate(deviceName(), { onError: () => setError(t('passkey.addFailed')) });
            }}
          />
        </View>
      ) : null}

      <SignedInDevices />
      <AccountActivity />
      <Checkbox
        label={t('signinAlerts.label')}
        hint={t('signinAlerts.hint')}
        checked={chatSettings.data?.signinAlerts ?? true}
        onChange={(v) =>
          setSigninAlerts.mutate(v, { onError: () => setError(t('common.genericError')) })
        }
      />

      <Button
        variant="secondary"
        label={t('contacts.open')}
        onPress={() => router.push('/hide-contacts')}
      />
      <Button
        variant="secondary"
        label={t('blocked.open')}
        onPress={() => router.push('/blocked')}
      />

      <AppText variant="caption" tone="muted">
        {screenCaptureBlocked ? t('security.screenshotsNative') : t('security.screenshotsWeb')}
      </AppText>

      {invites.data && (invites.data.allowed || invites.data.invites.length > 0) ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]} testID="my-invites">
          <AppText variant="label">{t('invite.title')}</AppText>
          <AppText variant="caption" tone="muted">
            {t('invite.intro', { count: invites.data.invites.length })}
          </AppText>
          {newCode ? (
            <AppText
              variant="heading"
              selectable
              accessibilityLiveRegion="polite"
              testID="new-code"
            >
              {newCode}
            </AppText>
          ) : null}
          {invites.data.allowed ? (
            <Button
              variant="secondary"
              label={t('invite.create')}
              loading={createInvite.isPending}
              onPress={() =>
                createInvite.mutate(undefined, {
                  onSuccess: (invite) => setNewCode(invite.code),
                  onError: () => setError(t('common.genericError')),
                })
              }
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
});
