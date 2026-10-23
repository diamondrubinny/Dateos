// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { AVAILABILITY_DAYS, dayParts, MAX_AVAILABILITY_SLOTS, parseSlot } from '@nexaheart/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { dayLabel, localDay } from '../../components/FreeTimes';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { useAvailability, useSetAvailability } from '../../lib/date-queries';
import { useLocale } from '../../lib/locale';

/** The next 14 days; a day of slack keeps every one inside the server's window in any time zone. */
const DAYS = Array.from({ length: AVAILABILITY_DAYS - 1 }, (_, i) => localDay(i));

/** "When I'm free" (phase 20): the other person only ever sees the times you share. */
function FreeTimesScreen() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { id: matchId, name = '' } = useLocalSearchParams<{ id: string; name?: string }>();
  const availability = useAvailability(matchId);
  const save = useSetAvailability(matchId);
  const [slots, setSlots] = useState<string[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (slots === undefined && availability.data) {
      setSlots(availability.data.mine.filter((s) => DAYS.includes(parseSlot(s).date)));
    }
  }, [availability.data, slots]);
  if (!slots)
    return availability.error ? (
      <Banner tone="error" message={t('common.genericError')} />
    ) : (
      <Loading />
    );

  const setDay = (date: string, parts: string[]) => {
    const next = [
      ...slots.filter((s) => parseSlot(s).date !== date),
      ...parts.map((p) => `${date}:${p}`),
    ];
    if (next.length > MAX_AVAILABILITY_SLOTS) {
      return setError(t('free.tooMany', { max: MAX_AVAILABILITY_SLOTS }));
    }
    setError(undefined);
    setSlots(next.sort());
  };

  const submit = () =>
    save.mutate(slots, {
      onSuccess: () => (router.canGoBack() ? router.back() : router.replace(`/chat/${matchId}`)),
      onError: () => setError(t('common.genericError')),
    });

  return (
    <Screen
      back
      title={t('free.title')}
      footer={<Button label={t('common.save')} loading={save.isPending} onPress={submit} />}
    >
      <AppText variant="body" tone="muted">
        {t('free.intro', { name })}
      </AppText>
      <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
        {t('free.count', { count: slots.length, max: MAX_AVAILABILITY_SLOTS })}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {DAYS.map((date) => (
        <ChoiceGroup
          key={date}
          label={dayLabel(date, locale)}
          multiple
          options={dayParts.map((value) => ({ value, label: t(`free.parts.${value}`) }))}
          selected={slots.filter((s) => parseSlot(s).date === date).map((s) => parseSlot(s).part)}
          onChange={(parts) => setDay(date, parts)}
        />
      ))}
    </Screen>
  );
}

export default function FreeTimesRoute() {
  return (
    <RequireSession>
      <FreeTimesScreen />
    </RequireSession>
  );
}
