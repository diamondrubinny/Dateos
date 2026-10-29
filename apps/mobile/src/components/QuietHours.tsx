// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { QuietHours as Quiet } from '@nexaheart/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useChatSettings, useSetQuietHours } from '../lib/chat-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Checkbox } from './Choice';

const STEP = 30;
const DEFAULT = { start: 23 * 60, end: 8 * 60 };

/** The device's time zone; quiet hours follow it. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** "23:00": always 24-hour digits, read the same in every language. */
export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const shift = (minutes: number, by: number) => (minutes + by + 1440) % 1440;

/**
 * Settings → Notifications → Quiet hours (phase 39): no notifications between two times, in this
 * device's time zone. Calls and safety check-in alerts still come.
 */
export function QuietHours({ onError }: { onError: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const settings = useChatSettings();
  const save = useSetQuietHours();
  const quiet = settings.data?.quietHours ?? null;

  const put = (next: Quiet | null) => save.mutate(next, { onError });
  const move = (edge: 'start' | 'end', by: number) => {
    if (!quiet) return;
    const next = { ...quiet, [edge]: shift(quiet[edge], by), timeZone: deviceTimeZone() };
    if (next.start !== next.end) put(next);
  };
  const row = (edge: 'start' | 'end') =>
    quiet ? (
      <View style={styles.row} testID={`quiet-${edge}`}>
        <AppText variant="body" accessibilityLiveRegion="polite">
          {t(`quiet.${edge}`, { time: clock(quiet[edge]) })}
        </AppText>
        <View style={styles.buttons}>
          <Button
            variant="secondary"
            label={t('quiet.earlier')}
            hint={t(`quiet.${edge}Earlier`)}
            onPress={() => move(edge, -STEP)}
          />
          <Button
            variant="secondary"
            label={t('quiet.later')}
            hint={t(`quiet.${edge}Later`)}
            onPress={() => move(edge, STEP)}
          />
        </View>
      </View>
    ) : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="quiet-hours">
      <Checkbox
        label={t('quiet.label')}
        hint={t('quiet.hint')}
        checked={quiet !== null}
        onChange={(on) => put(on ? { ...DEFAULT, timeZone: deviceTimeZone() } : null)}
      />
      {row('start')}
      {row('end')}
      {quiet ? (
        <AppText variant="caption" tone="muted">
          {t('quiet.zone', { zone: quiet.timeZone })}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { gap: spacing.xs },
  buttons: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
