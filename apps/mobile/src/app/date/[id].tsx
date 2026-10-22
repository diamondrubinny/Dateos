import { DATE_MIN_LEAD_MINUTES, MAX_DATE_NOTE_LENGTH, type VenueCategory } from '@nexaheart/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { formatDateTime } from '../../components/DateCard';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { ApiRequestError } from '../../lib/api';
import { newClientId } from '../../lib/chat-queries';
import { useProposeDate, useVenues } from '../../lib/date-queries';
import { useLocale } from '../../lib/locale';
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
  const { id: matchId, name = '' } = useLocalSearchParams<{ id: string; name?: string }>();
  const venues = useVenues();
  const propose = useProposeDate(matchId);
  const [category, setCategory] = useState<'all' | VenueCategory>('all');
  const [venueId, setVenueId] = useState<string>();
  const [dayOffset, setDayOffset] = useState('1');
  const [hour, setHour] = useState('19');
  const [minute, setMinute] = useState('0');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [clientId] = useState(newClientId);

  const list = venues.data ?? [];
  const categories = useMemo(() => [...new Set(list.map((v) => v.category))], [list]);
  const shown = category === 'all' ? list : list.filter((v) => v.category === category);
  const venue = list.find((v) => v.id === venueId);

  const startsAt = new Date(day(Number(dayOffset)));
  startsAt.setHours(Number(hour), Number(minute), 0, 0);

  if (venues.isPending) return <Loading />;

  const submit = () => {
    setError(undefined);
    if (!venue) return setError(t('datePlan.pickPlace'));
    if (startsAt.getTime() < Date.now() + DATE_MIN_LEAD_MINUTES * 60_000) {
      return setError(t('datePlan.tooSoon', { n: DATE_MIN_LEAD_MINUTES }));
    }
    propose.mutate(
      {
        venueId: venue.id,
        startsAt: startsAt.toISOString(),
        clientId,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => router.back(),
        onError: (e) =>
          setError(
            e instanceof ApiRequestError && e.status === 409
              ? t('datePlan.alreadyOpen')
              : e instanceof ApiRequestError && e.status === 422 && note.trim()
                ? t('datePlan.kinder')
                : e instanceof ApiRequestError && e.status === 404
                  ? t('datePlan.placeGone')
                  : t('common.genericError'),
          ),
      },
    );
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
    <Screen back title={t('datePlan.title')}>
      <AppText variant="body">{t('datePlan.intro', { name })}</AppText>
      {list.length === 0 ? (
        <Banner tone="info" message={t('datePlan.noPlaces')} />
      ) : (
        <>
          {error ? <Banner tone="error" message={error} /> : null}
          {categories.length > 1 ? (
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
              ]
                .filter(Boolean)
                .join(' · '),
            }))}
            selected={venueId ? [venueId] : []}
            onChange={([v]) => setVenueId(v)}
          />
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
          <Button label={t('datePlan.send')} loading={propose.isPending} onPress={submit} />
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
