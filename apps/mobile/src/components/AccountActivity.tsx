// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { ACCOUNT_ACTIVITY_DAYS, type AccountActivity as Activity } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { useAccountActivity } from '../lib/trust-queries';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { useDeviceName } from './SignedInDevices';

const FIRST = 5;

/**
 * Settings → Security → Account activity (phase 31): sign-ins, devices signed out and data
 * downloads of the last 90 days, so a member notices a sign-in that wasn't them.
 */
export function AccountActivity() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const activity = useAccountActivity();
  const deviceName = useDeviceName();
  const [all, setAll] = useState(false);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  const line = (e: Activity['events'][number]) =>
    e.kind === 'signed_in'
      ? t('activity.signedIn', { device: e.device ? deviceName(e.device) : t('devices.unknown') })
      : e.kind === 'signed_out_others'
        ? t('activity.signedOutOthers', { count: e.count ?? 0 })
        : t(`activity.${e.kind === 'device_signed_out' ? 'deviceSignedOut' : 'dataDownloaded'}`);
  const events = activity.data ?? [];
  const shown = all ? events : events.slice(0, FIRST);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="account-activity">
      <AppText variant="label">{t('activity.title')}</AppText>
      <AppText variant="caption" tone="muted">
        {t('activity.intro', { days: ACCOUNT_ACTIVITY_DAYS })}
      </AppText>
      {activity.isError ? <Banner tone="error" message={t('common.genericError')} /> : null}
      <View role="list">
        {shown.map((e, i) => (
          <View key={`${e.at}-${i}`} style={styles.row} role="listitem">
            <AppText variant="body">{line(e)}</AppText>
            <AppText variant="caption" tone="muted">
              {when(e.at)}
            </AppText>
          </View>
        ))}
      </View>
      {events.length > FIRST ? (
        <Button
          variant="ghost"
          label={all ? t('activity.less') : t('activity.more', { count: events.length - FIRST })}
          onPress={() => setAll(!all)}
        />
      ) : null}
      <AppText variant="caption" tone="muted">
        {t('activity.notYou')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  row: { paddingVertical: spacing.xs, gap: 2 },
});
