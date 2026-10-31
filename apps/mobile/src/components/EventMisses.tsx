// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useEventMisses, useExcuseMiss } from '../lib/event-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

/**
 * Missed events (phase 71a), only for the member: a gentle note after the first, and the pause on
 * new places after two in 30 days, with the date it ends. One miss a month can be excused, no
 * questions asked. Nothing shows when there's nothing to say.
 */
export function EventMisses() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const misses = useEventMisses();
  const excuse = useExcuseMiss();
  const [error, setError] = useState(false);
  const counted = misses.data?.noShows.filter((m) => !m.excused) ?? [];
  if (!misses.data || counted.length === 0) return null;
  const { pausedUntil, canExcuse } = misses.data;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' });

  return (
    <View
      testID="event-misses"
      style={[styles.card, { backgroundColor: pausedUntil ? colors.primarySoft : colors.surface }]}
    >
      <AppText variant="heading" accessibilityRole="header">
        {pausedUntil ? t('eventMisses.pausedTitle') : t('eventMisses.title')}
      </AppText>
      <AppText variant="body">
        {pausedUntil
          ? t('eventMisses.paused', { date: date(pausedUntil) })
          : t('eventMisses.first', { event: counted[0]!.title })}
      </AppText>
      {canExcuse ? (
        <>
          <AppText variant="caption" tone="muted">
            {t('eventMisses.excuseHint')}
          </AppText>
          {counted.map((m) => (
            <Button
              key={m.eventId}
              variant="secondary"
              label={t('eventMisses.excuse', { event: m.title })}
              loading={excuse.isPending}
              onPress={() => {
                setError(false);
                excuse.mutate(m.eventId, { onError: () => setError(true) });
              }}
            />
          ))}
        </>
      ) : null}
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});
