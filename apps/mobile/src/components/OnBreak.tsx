// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { PauseState } from '@nexaheart/shared';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useLocale } from '../lib/locale';
import { useMe, useResume } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

/** "Until Friday, 14:00" or "until you come back". */
export function breakEnds(pause: NonNullable<PauseState>, locale: string, t: TFunction) {
  if (!pause.until) return t('pause.untilBack');
  const when = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(pause.until));
  return t('pause.until', { when });
}

/**
 * Shown instead of Discover, Picks and Likes while the member takes a break (phase 18a). Matches
 * and chats stay open, so the card says so.
 */
export function OnBreak() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const pause = useMe().data?.pause;
  const resume = useResume();
  const [error, setError] = useState(false);
  if (!pause) return null;
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface }]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      testID="on-break"
    >
      <AppText variant="heading" center accessibilityRole="header">
        {t('pause.onBreakTitle')}
      </AppText>
      <AppText variant="body" center>
        {breakEnds(pause, locale, t)}
      </AppText>
      <AppText variant="body" tone="muted" center>
        {t('pause.onBreakBody')}
      </AppText>
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      <Button
        label={t('pause.comeBack')}
        loading={resume.isPending}
        onPress={() => resume.mutate(undefined, { onError: () => setError(true) })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.xl, borderRadius: radius.lg, gap: spacing.md },
});
