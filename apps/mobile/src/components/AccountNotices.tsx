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

/**
 * Moderator warnings the member has not acknowledged yet (the category only), then "Your report was
 * reviewed" (phase 37): whether something was done, never which action.
 */
export function AccountNotices() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const ack = useAcknowledgeNotice();
  const notice = me.data?.notices[0];
  if (!notice) return null;
  const category = t(`report.categories.${notice.category}`);
  if (notice.kind === 'report_reviewed') {
    const date = new Date(notice.createdAt).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
    });
    return (
      <View
        style={[styles.card, { backgroundColor: colors.primarySoft }]}
        accessibilityRole="summary"
        testID="report-reviewed"
      >
        <AppText variant="heading">{t('account.reviewedTitle')}</AppText>
        <AppText variant="body">{t('account.reviewedAbout', { category, date })}</AppText>
        <AppText variant="body">
          {notice.outcome === 'actioned'
            ? t('account.reviewedActioned')
            : t('account.reviewedNone')}
        </AppText>
        <AppText variant="caption" tone="muted">
          {t('account.reviewedThanks')}
        </AppText>
        <Button
          variant="secondary"
          label={t('account.reviewedOk')}
          loading={ack.isPending}
          onPress={() => ack.mutate(notice.id)}
        />
      </View>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: colors.dangerSoft }]} accessibilityRole="alert">
      <AppText variant="heading" tone="danger">
        {t('account.warningTitle')}
      </AppText>
      <AppText variant="body">{t('account.warningBody', { category })}</AppText>
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
