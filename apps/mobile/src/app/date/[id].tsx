// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  DATE_MIN_LEAD_MINUTES,
  MAX_DATE_NOTE_LENGTH,
  STEP_FREE_NEEDS,
  type VenueCategory,
  NEW_ACCOUNT_CHAT_STARTS,
} from '@nexaheart/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Checkbox, ChoiceGroup } from '../../components/Choice';
import { formatDateTime } from '../../components/DateCard';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { ApiRequestError } from '../../lib/api';
import { newClientId, useConversations } from '../../lib/chat-queries';
import { useCounterDate, useProposeDate, useVenues } from '../../lib/date-queries';
import { useLocale } from '../../lib/locale';
import { useMe } from '../../lib/queries';
import { radius, spacing, useColors } from '../../lib/theme';

const DAYS = 14;
const HOURS = Array.from({ length: 14 }, (_, i) => i + 9); // 09:00 to 22:00
const MINUTES = [0, 15, 30, 45] as const;

/** Midnight of the local day `offset` days from today. */
function day(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function PlanDateScreen() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const {
    id: matchId,
    name = '',
    day: wantedDay,
    hour: wantedHour,
    counter: counterOf,
    place: counterPlace = '',
    startsAt: counterFrom,
  } = useLocalSearchParams<{
    id: string;
    name?: string;
    day?: string;
    hour?: string;
    /** "Suggest another time" (phase 46): the idea being answered, its place and time. */
    counter?: string;
    place?: string;
    startsAt?: string;
  }>();
  const venues = useVenues();
  // Phase 25: my own needs, or the ones the other person chose to show, put step-free places first.
  const myNeeds = useMe().data?.accessNeeds.needs ?? [];
  const theirNeeds =
    useConversations().data?.find((c) => c.matchId === matchId)?.profile.accessNeeds ?? [];
  const needsStepFree = [...myNeeds, ...theirNeeds].some((n) => STEP_FREE_NEEDS.includes(n));
  const [stepFreeOnly, setStepFreeOnly] = useState<boolean>();
  // Phase 74b: kosher places only, by choice.
  const [kosherOnly, setKosherOnly] = useState(false);
  const propose = useProposeDate(matchId);
  const counter = useCounterDate(matchId);
  const sending = counterOf ? counter : propose;
  const [category, setCategory] = useState<'all' | VenueCategory>('all');
  const [venueId, setVenueId] = useState<string>();
  // Opened from a shared free time (phase 20): that day and part of the day are filled in.
  const [dayOffset, setDayOffset] = useState(() => {
    const [y, m, d] = (wantedDay ?? '').split('-').map(Number);
    const offset =
      y && m && d
        ? Math.round((new Date(y, m - 1, d).getTime() - day(0).getTime()) / 86_400_000)
        : NaN;
    return Number.isInteger(offset) && offset >= 0 && offset < DAYS ? String(offset) : '1';
  });
  const [hour, setHour] = useState(() =>
    wantedHour && HOURS.includes(Number(wantedHour)) ? wantedHour : '19',
  );
  const [minute, setMinute] = useState('0');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [clientId] = useState(newClientId);

  const list = venues.data ?? [];
  const categories = useMemo(() => [...new Set(list.map((v) => v.category))], [list]);
  const onlyStepFree = stepFreeOnly ?? needsStepFree;
  const shown = list
    .filter((v) => category === 'all' || v.category === category)
    .filter((v) => !onlyStepFree || v.stepFree)
    .filter((v) => !kosherOnly || v.kosher)
    // Step-free places first whenever it matters to either person.
    .sort((a, b) => (needsStepFree ? Number(b.stepFree) - Number(a.stepFree) : 0));
  const venue = list.find((v) => v.id === venueId);

  const startsAt = new Date(day(Number(dayOffset)));
  startsAt.setHours(Number(hour), Number(minute), 0, 0);

  if (venues.isPending && !counterOf) return <Loading />;

  const onError = (e: Error) =>
    setError(
      e instanceof ApiRequestError && e.code === 'SLOW_DOWN'
        ? t('chat.newAccountLimit', { count: NEW_ACCOUNT_CHAT_STARTS })
        : e instanceof ApiRequestError && e.status === 409
          ? t(counterOf ? 'datePlan.changed' : 'datePlan.alreadyOpen')
          : e instanceof ApiRequestError && e.status === 422 && note.trim()
            ? t('datePlan.kinder')
            : e instanceof ApiRequestError && e.status === 404
              ? t('datePlan.placeGone')
              : t('common.genericError'),
    );

  const submit = () => {
    setError(undefined);
    if (!counterOf && !venue) return setError(t('datePlan.pickPlace'));
    if (startsAt.getTime() < Date.now() + DATE_MIN_LEAD_MINUTES * 60_000) {
      return setError(t('datePlan.tooSoon', { n: DATE_MIN_LEAD_MINUTES }));
    }
    if (counterFrom && startsAt.getTime() === Date.parse(counterFrom)) {
      return setError(t('datePlan.sameTime'));
    }
    const common = {
      startsAt: startsAt.toISOString(),
      clientId,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const done = { onSuccess: () => router.back(), onError };
    if (counterOf) counter.mutate({ id: counterOf, ...common }, done);
    else if (venue) propose.mutate({ venueId: venue.id, ...common }, done);
  };

  const dayLabel = (offset: number) =>
    offset === 0
      ? t('datePlan.today')
      : offset === 1
        ? t('datePlan.tomorrow')
        : new Intl.DateTimeFormat(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }).format(day(offset));
  const two = (n: number) => String(n).padStart(2, '0');

  return (
    <Screen back title={t(counterOf ? 'datePlan.counterTitle' : 'datePlan.title')}>
      <AppText variant="body">
        {counterOf ? t('datePlan.counterIntro', { name }) : t('datePlan.intro', { name })}
      </AppText>
      {list.length === 0 && !counterOf ? (
        <Banner tone="info" message={t('datePlan.noPlaces')} />
      ) : (
        <>
          {error ? <Banner tone="error" message={error} /> : null}
          {counterOf ? (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <AppText variant="label">{t('datePlan.samePlace')}</AppText>
              <AppText variant="body" userContent>
                {counterPlace}
              </AppText>
              {counterFrom ? (
                <AppText variant="caption" tone="muted">
                  {t('datePlan.theirTime', { when: formatDateTime(counterFrom, locale) })}
                </AppText>
              ) : null}
            </View>
          ) : null}
          {!counterOf && categories.length > 1 ? (
            <ChoiceGroup
              label={t('datePlan.type')}
              options={[
                { value: 'all' as const, label: t('datePlan.all') },
                ...categories.map((c) => ({ value: c, label: t(`datePlan.categories.${c}`) })),
              ]}
              selected={[category]}
              onChange={([v]) => v && setCategory(v)}
            />
          ) : null}
          {!counterOf && list.some((v) => v.stepFree) ? (
            <Checkbox
              label={t('access.stepFreeOnly')}
              {...(needsStepFree ? { hint: t('access.stepFreeOnlyHint') } : {})}
              checked={onlyStepFree}
              onChange={setStepFreeOnly}
            />
          ) : null}
          {!counterOf && list.some((v) => v.kosher) ? (
            <Checkbox
              label={t('datePlan.kosherOnly')}
              checked={kosherOnly}
              onChange={setKosherOnly}
            />
          ) : null}
          {counterOf ? null : (
            <ChoiceGroup
              stacked
              label={t('datePlan.place')}
              options={shown.map((v) => ({
                value: v.id,
                label: [
                  v.name,
                  v.area,
                  t(`datePlan.categories.${v.category}`),
                  v.stepFree ? `♿ ${t('datePlan.stepFree')}` : null,
                  v.kosher ? t('datePlan.kosher') : null,
                  v.shabbatClosed ? t('datePlan.shabbatClosed') : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
              }))}
              selected={venueId ? [venueId] : []}
              onChange={([v]) => setVenueId(v)}
            />
          )}
          {venue ? (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <AppText variant="label" userContent>
                {venue.address}
              </AppText>
              {venue.note ? (
                <AppText variant="caption" tone="muted" userContent>
                  {venue.note}
                </AppText>
              ) : null}
            </View>
          ) : null}
          <ChoiceGroup
            label={t('datePlan.day')}
            options={Array.from({ length: DAYS }, (_, i) => ({
              value: String(i),
              label: dayLabel(i),
            }))}
            selected={[dayOffset]}
            onChange={([v]) => v && setDayOffset(v)}
          />
          <ChoiceGroup
            label={t('datePlan.hour')}
            options={HOURS.map((h) => ({ value: String(h), label: `${two(h)}:00` }))}
            selected={[hour]}
            onChange={([v]) => v && setHour(v)}
          />
          <ChoiceGroup
            label={t('datePlan.minutes')}
            options={MINUTES.map((m) => ({ value: String(m), label: `:${two(m)}` }))}
            selected={[minute]}
            onChange={([v]) => v && setMinute(v)}
          />
          <AppText variant="body" accessibilityLiveRegion="polite">
            {t('datePlan.when', { when: formatDateTime(startsAt.toISOString(), locale) })}
          </AppText>
          <TextField
            label={t('datePlan.note')}
            hint={t('datePlan.noteHint')}
            optionalLabel={t('common.optional')}
            value={note}
            onChangeText={setNote}
            maxLength={MAX_DATE_NOTE_LENGTH}
          />
          <Banner tone="info" message={t('datePlan.safety')} />
          <Button
            label={t(counterOf ? 'datePlan.counterSend' : 'datePlan.send')}
            loading={sending.isPending}
            onPress={submit}
          />
        </>
      )}
    </Screen>
  );
}

export default function PlanDateRoute() {
  return (
    <RequireSession>
      <PlanDateScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
});
