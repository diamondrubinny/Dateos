// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useMe } from '../lib/queries';
import { useAcknowledgeNotice } from '../lib/safety-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/** Moderator warnings the member has not acknowledged yet. Shows the category only. */
export function AccountNotices() {
  const { t } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const ack = useAcknowledgeNotice();
  const notice = me.data?.notices[0];
  if (!notice) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.dangerSoft }]} accessibilityRole="alert">
      <AppText variant="heading" tone="danger">
        {t('account.warningTitle')}
      </AppText>
      <AppText variant="body">
        {t('account.warningBody', { category: t(`report.categories.${notice.category}`) })}
      </AppText>
      <Button
        variant="secondary"
        label={t('account.warningAck')}
        loading={ack.isPending}
        onPress={() => ack.mutate(notice.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
});
