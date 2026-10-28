// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { SignedInDevice } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { useSignedInDevices, useSignOutDevice, useSignOutOthers } from '../lib/trust-queries';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

/** A device's name in the app's language (phase 29); also used by Account activity (phase 31). */
export function useDeviceName() {
  const { t } = useTranslation();
  // Browser and system names are proper names; only the sentence around them is translated.
  return (device: SignedInDevice['device']): string =>
    device.kind === 'app'
      ? t('devices.app', { os: device.os })
      : device.kind === 'web' && device.browser && device.os
        ? t('devices.web', { browser: device.browser, os: device.os })
        : device.kind === 'web'
          ? (device.browser ?? device.os ?? t('devices.unknown'))
          : t('devices.unknown');
}

/**
 * Settings → Security → Your devices (phase 29): where I'm signed in, with a coarse label only,
 * and signing out of a device I don't recognise.
 */
export function SignedInDevices() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const devices = useSignedInDevices();
  const signOut = useSignOutDevice();
  const signOutOthers = useSignOutOthers();
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string }>();
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const list = devices.data ?? [];
  const deviceName = useDeviceName();
  const name = ({ device }: SignedInDevice) => deviceName(device);
  const others = list.filter((d) => !d.current).length;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="signed-in-devices">
      <AppText variant="label">{t('devices.title')}</AppText>
      <AppText variant="caption" tone="muted">
        {t('devices.intro')}
      </AppText>
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
      {devices.isError ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {list.map((device) => (
        <View key={device.id} style={styles.row} testID="device-row">
          <View style={styles.grow}>
            <AppText variant="body">
              {name(device)}
              {device.current ? ` · ${t('devices.thisDevice')}` : ''}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('devices.dates', {
                signedIn: day(device.signedInAt),
                lastActive: day(device.lastActiveAt),
              })}
            </AppText>
          </View>
          {device.current ? null : (
            <Button
              variant="dangerGhost"
              label={t('devices.signOut')}
              hint={name(device)}
              loading={signOut.isPending && signOut.variables === device.id}
              onPress={() => {
                setMessage(undefined);
                signOut.mutate(device.id, {
                  onSuccess: () =>
                    setMessage({ tone: 'success', text: t('devices.signedOut', { count: 1 }) }),
                  onError: () => setMessage({ tone: 'error', text: t('common.genericError') }),
                });
              }}
            />
          )}
        </View>
      ))}
      {others > 0 ? (
        <Button
          variant="secondary"
          label={t('devices.signOutOthers')}
          loading={signOutOthers.isPending}
          onPress={() => {
            setMessage(undefined);
            signOutOthers.mutate(undefined, {
              onSuccess: (res) =>
                setMessage({
                  tone: 'success',
                  text: t('devices.signedOut', { count: res.signedOut }),
                }),
              onError: () => setMessage({ tone: 'error', text: t('common.genericError') }),
            });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
});
