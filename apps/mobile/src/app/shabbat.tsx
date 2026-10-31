// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { candleMinutes, SHABBAT_CONSENT_VERSION } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Checkbox, ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { useMe, useSetConsents } from '../lib/queries';
import { deviceTimeZone, useSetShabbat, useShabbat } from '../lib/shabbat-queries';
import { radius, spacing, useColors } from '../lib/theme';

/**
 * Phase 74a: Shabbat and holiday mode. Keeping Shabbat is religious information, so it needs its
 * own consent ⚖️; times come from the approximate location and the device's time zone.
 */
function ShabbatScreen() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const consents = useSetConsents();
  const settings = useShabbat();
  const save = useSetShabbat();
  const [error, setError] = useState<string>();

  if (me.isPending || settings.isPending) return <Loading />;
  const allowed = me.data?.consents.shabbat === true;
  const s = settings.data;
  const fail = () => setError(t('common.genericError'));
  const set = (input: Parameters<typeof save.mutate>[0]) =>
    save.mutate(input, { onError: fail, onSuccess: () => setError(undefined) });
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Screen back title={t('shabbat.title')}>
      <AppText variant="body">{t('shabbat.intro')}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Checkbox
          label={t('shabbat.consent')}
          hint={t('shabbat.consentHint')}
          checked={allowed}
          onChange={(granted) =>
            consents.mutate([{ kind: 'shabbat', granted, version: SHABBAT_CONSENT_VERSION }], {
              onSuccess: () => {
                void settings.refetch();
                if (granted) set({ on: true, timeZone: deviceTimeZone() });
              },
              onError: fail,
            })
          }
        />
      </View>
      {allowed && s ? (
        <>
          <Checkbox
            label={t('shabbat.on')}
            checked={s.on}
            onChange={(on) => set({ on, timeZone: deviceTimeZone() })}
          />
          {s.on ? (
            <>
              {!s.located ? (
                <Banner tone="info" message={t('shabbat.noLocation')} />
              ) : s.next ? (
                <AppText variant="body" testID="shabbat-next">
                  {Date.parse(s.next.start) <= Date.now()
                    ? t(s.next.kind === 'holiday' ? 'shabbat.nowHoliday' : 'shabbat.nowShabbat', {
                        end: when(s.next.end),
                      })
                    : t(s.next.kind === 'holiday' ? 'shabbat.nextHoliday' : 'shabbat.next', {
                        start: when(s.next.start),
                        end: when(s.next.end),
                      })}
                </AppText>
              ) : null}
              <Checkbox
                label={t('shabbat.showMatches')}
                hint={t('shabbat.showMatchesHint')}
                checked={s.showMatches}
                onChange={(showMatches) => set({ showMatches })}
              />
              <ChoiceGroup<string>
                label={t('shabbat.candles')}
                stacked
                options={candleMinutes.map((n) => ({
                  value: String(n),
                  label: t('shabbat.candlesOption', { n }),
                }))}
                selected={[String(s.candles)]}
                onChange={([next]) => next && set({ candles: Number(next) })}
              />
              <Checkbox
                label={t('shabbat.secondDay')}
                hint={t('shabbat.secondDayHint')}
                checked={s.secondDay}
                onChange={(secondDay) => set({ secondDay })}
              />
              <AppText variant="caption" tone="muted">
                {t('shabbat.how')}
              </AppText>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
});

export default function ShabbatRoute() {
  return (
    <RequireSession>
      <ShabbatScreen />
    </RequireSession>
  );
}
