// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { DAY_PART_HOUR, parseSlot, type DayPart } from '@nexaheart/shared';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAvailability } from '../lib/date-queries';
import { useLocale } from '../lib/locale';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/** "YYYY-MM-DD" of the local day `offset` days from today. */
export function localDay(offset: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayLabel(date: string, locale: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(new Date(y, m - 1, d, 12));
}

export function slotLabel(slot: string, locale: string, t: TFunction): string {
  const { date, part } = parseSlot(slot);
  return t('free.slot', { day: dayLabel(date, locale), part: t(`free.parts.${part}`) });
}

/**
 * When we're both free (phase 20), above the chat: only the overlap of the two lists is shown.
 * Tapping a time opens the date planner with that day and time filled in.
 */
export function FreeTimes({ matchId, name }: { matchId: string; name: string }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const availability = useAvailability(matchId);
  const data = availability.data;
  if (!data) return null;
  // The server keeps a day of slack for time zones; days already over here aren't offered.
  const today = localDay(0);
  const overlap = data.overlap.filter((slot) => parseSlot(slot).date >= today);

  const edit = () => router.push({ pathname: '/free/[id]', params: { id: matchId, name } });
  const plan = (slot: string) => {
    const { date, part } = parseSlot(slot);
    router.push({
      pathname: '/date/[id]',
      params: { id: matchId, name, day: date, hour: String(DAY_PART_HOUR[part as DayPart]) },
    });
  };

  return (
    <View
      testID="free-times"
      style={[styles.wrap, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
    >
      {overlap.length > 0 ? (
        <>
          <AppText variant="label" tone="success">
            {t('free.overlap')}
          </AppText>
          <View style={styles.chips} role="list" accessibilityLabel={t('free.overlap')}>
            {overlap.map((slot) => (
              <View key={slot} role="listitem">
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={t('free.planHint')}
                  onPress={() => plan(slot)}
                  style={[styles.chip, { borderColor: colors.success }]}
                >
                  <AppText variant="label" tone="success">
                    {slotLabel(slot, locale, t)}
                  </AppText>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : (
        <AppText variant="caption" tone="muted">
          {data.mine.length === 0
            ? data.theyShared
              ? t('free.theyShared', { name })
              : t('free.invite')
            : data.theyShared
              ? t('free.noOverlap')
              : t('free.waiting', { name })}
        </AppText>
      )}
      <Pressable accessibilityRole="button" onPress={edit} style={styles.link}>
        <AppText variant="label" tone="primary">
          🗓 {data.mine.length ? t('free.edit') : t('free.share')}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
  },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
});
