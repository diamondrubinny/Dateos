// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { apiFetch } from '../lib/api';
import { keys, useMe } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * Phase 68c: where a moderator approves new profiles, say that mine is waiting, or what to change
 * (with the moderator's note), and let me send it again. Nobody else learns about it.
 */
export function ReviewBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  const review = useMe().data?.review;
  const client = useQueryClient();
  const resubmit = useMutation({
    mutationFn: () => apiFetch('/v1/me/review/resubmit', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.me }),
  });
  if (!review || review.status === 'approved') return null;
  return (
    <View
      testID="review-banner"
      accessibilityRole={review.status === 'changes' ? 'alert' : undefined}
      style={[styles.box, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
    >
      {review.status === 'pending' ? (
        <>
          <AppText variant="label" tone="primary">
            {t('review.pendingTitle')}
          </AppText>
          <AppText variant="body">{t('review.pendingBody')}</AppText>
        </>
      ) : (
        <>
          <AppText variant="label" tone="primary">
            {t('review.changesTitle', {
              reason: t(`review.reasons.${review.reason ?? 'other'}`),
            })}
          </AppText>
          {review.note ? (
            <AppText variant="body" userContent>
              {review.note}
            </AppText>
          ) : null}
          <AppText variant="caption">{t('review.changesHint')}</AppText>
          <Button
            label={t('review.resubmit')}
            loading={resubmit.isPending}
            onPress={() => resubmit.mutate()}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
