// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { pauseDurations, type PauseDuration } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useLocale } from '../lib/locale';
import { useMe, usePause, useResume } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { ChoiceGroup } from './Choice';
import { breakEnds } from './OnBreak';

/** Settings: take a break from new people, or come back (phase 18a). */
export function TakeABreak() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const pause = useMe().data?.pause;
  const start = usePause();
  const resume = useResume();
  const [duration, setDuration] = useState<PauseDuration>('3d');
  const [error, setError] = useState(false);
  const onError = () => setError(true);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="take-a-break">
      <AppText variant="heading">{t('pause.title')}</AppText>
      <AppText variant="body" tone="muted">
        {t('pause.hint')}
      </AppText>
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {pause ? (
        <>
          <Banner
            tone="info"
            message={`${t('pause.onBreakTitle')} ${breakEnds(pause, locale, t)}`}
          />
          <Button
            label={t('pause.comeBack')}
            loading={resume.isPending}
            onPress={() => {
              setError(false);
              resume.mutate(undefined, { onError });
            }}
          />
        </>
      ) : (
        <>
          <ChoiceGroup
            label={t('pause.howLong')}
            options={pauseDurations.map((value) => ({
              value,
              label: t(`pause.duration.${value}`),
            }))}
            selected={[duration]}
            onChange={(next) => setDuration(next[0] ?? '3d')}
          />
          <Button
            variant="secondary"
            label={t('pause.start')}
            loading={start.isPending}
            onPress={() => {
              setError(false);
              start.mutate(duration, { onError });
            }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
});
