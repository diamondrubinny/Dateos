// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { cityName, travelDayOptions, type Place, type TravelState } from '@nexaheart/shared';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useLocale } from '../lib/locale';
import { useEndTravel, useInstance, usePlaces, useStartTravel, useTravel } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { Checkbox, ChoiceGroup } from './Choice';
import { TextField } from './TextField';

/** "Haifa, Israel" in the member's language (country names from the platform, when it has them). */
export function placeLabel(place: Pick<Place, 'names' | 'country'>, locale: string): string {
  let country = place.country;
  try {
    country = new Intl.DisplayNames([locale], { type: 'region' }).of(place.country) ?? country;
  } catch {
    // Older JavaScript engines: the country code is still clear enough.
  }
  return `${cityName(place.names, locale)}, ${country}`;
}

/** "Travel mode: Haifa until Friday, 5 November". */
export function travelLine(travel: NonNullable<TravelState>, locale: string, t: TFunction) {
  const until = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(travel.until));
  return t('travel.active', { city: cityName(travel.names, locale), until });
}

/** Wait until typing pauses before searching. */
function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Settings: travel mode (phase 18c). */
export function TravelMode() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const travel = useTravel();
  const start = useStartTravel();
  const end = useEndTravel();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<Place>();
  const [days, setDays] = useState<string>('7');
  const [error, setError] = useState(false);
  // Phase 67b: a country the community considers dangerous: warn, and hide me there by default.
  const riskCountries = useInstance().data?.community.riskCountries ?? [];
  const atRisk = Boolean(city && riskCountries.includes(city.country));
  const [hide, setHide] = useState(true);
  const search = usePlaces(useDebounced(query));
  const results = search.data ?? [];
  const onError = () => setError(true);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="travel-mode">
      <AppText variant="heading">{t('travel.title')}</AppText>
      <AppText variant="body" tone="muted">
        {t('travel.hint')}
      </AppText>
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {travel.data ? (
        <>
          <Banner tone="info" message={travelLine(travel.data, locale, t)} />
          {travel.data.atRisk ? (
            <Banner
              tone={travel.data.hidden ? 'info' : 'error'}
              message={travel.data.hidden ? t('travel.hiddenThere') : t('travel.riskWarning')}
            />
          ) : null}
          <Button
            label={t('travel.end')}
            loading={end.isPending}
            onPress={() => {
              setError(false);
              end.mutate(undefined, { onError });
            }}
          />
        </>
      ) : (
        <>
          <TextField
            label={t('travel.search')}
            hint={t('travel.searchHint')}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setCity(undefined);
            }}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {/* Announced as the list changes, so a screen reader knows results arrived. */}
          <AppText
            variant="caption"
            tone="muted"
            accessibilityLiveRegion="polite"
            aria-live="polite"
          >
            {query.trim().length >= 2 && search.isFetched
              ? t('travel.found', { count: results.length })
              : ''}
          </AppText>
          {results.length > 0 ? (
            <ChoiceGroup
              label={t('travel.choose')}
              stacked
              options={results.map((p) => ({ value: String(p.id), label: placeLabel(p, locale) }))}
              selected={city ? [String(city.id)] : []}
              onChange={(next) => setCity(results.find((p) => String(p.id) === next[0]))}
            />
          ) : null}
          {atRisk ? (
            <View testID="travel-risk">
              <Banner tone="error" message={t('travel.riskWarning')} />
              <Checkbox
                label={t('travel.hideLabel')}
                hint={t('travel.hideHint')}
                checked={hide}
                onChange={setHide}
              />
            </View>
          ) : null}
          <ChoiceGroup
            label={t('travel.howLong')}
            options={travelDayOptions.map((d) => ({
              value: String(d),
              label: t(`travel.duration.${d}`),
            }))}
            selected={[days]}
            onChange={(next) => setDays(next[0] ?? '7')}
          />
          <Button
            variant="secondary"
            label={
              city ? t('travel.startIn', { city: cityName(city.names, locale) }) : t('travel.start')
            }
            disabled={!city}
            loading={start.isPending}
            onPress={() => {
              if (!city) return;
              setError(false);
              start.mutate(
                {
                  cityId: city.id,
                  days: Number(days),
                  ...(atRisk ? { hideWhileThere: hide } : {}),
                },
                { onError },
              );
            }}
          />
        </>
      )}
      {/* CC BY 4.0 asks for attribution wherever the city data is used. */}
      <AppText
        variant="caption"
        tone="muted"
        accessibilityRole="link"
        onPress={() => void Linking.openURL('https://www.geonames.org')}
        style={styles.credit}
      >
        {t('travel.dataCredit')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  credit: { textDecorationLine: 'underline', paddingVertical: 12 },
});
