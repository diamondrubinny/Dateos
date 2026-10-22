import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { eventStatus, formatEventTime } from '../../components/EventCard';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { ApiRequestError } from '../../lib/api';
import { useEvent, useRsvp } from '../../lib/event-queries';
import { useLocale } from '../../lib/locale';
import { radius, spacing, useColors } from '../../lib/theme';

function EventScreen() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const rsvp = useRsvp(id);
  const [error, setError] = useState<string>();

  if (event.isPending) return <Loading />;
  const e = event.data;
  if (!e) {
    return (
      <Screen back title={t('events.title')}>
        <Banner tone="info" message={t('events.gone')} />
      </Screen>
    );
  }
  const cancelled = e.status === 'cancelled';
  const waiting = e.waitingAhead !== null;
  const answer = (action: 'going' | 'waitlist' | 'leave') => {
    setError(undefined);
    rsvp.mutate(action, {
      onError: (err) =>
        setError(
          err instanceof ApiRequestError && err.status === 409
            ? t('events.fullNow')
            : t('common.genericError'),
        ),
    });
  };

  return (
    <Screen back title={e.title}>
      {cancelled ? <Banner tone="error" message={t('events.cancelledBody')} /> : null}
      <AppText variant="heading">{formatEventTime(e, locale)}</AppText>
      {e.venue ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <AppText variant="label" userContent>
            {t('datePlan.placeWithArea', { name: e.venue.name, area: e.venue.area })}
          </AppText>
          <AppText variant="body" tone="muted" userContent selectable>
            {e.venue.address}
          </AppText>
          {e.venue.stepFree ? (
            <AppText variant="caption" tone="success">
              ♿ {t('datePlan.stepFree')}
            </AppText>
          ) : null}
          {e.venue.note ? (
            <AppText variant="caption" tone="muted" userContent>
              {e.venue.note}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {e.description ? (
        <AppText variant="body" userContent>
          {e.description}
        </AppText>
      ) : null}
      <AppText
        variant="label"
        tone={cancelled ? 'danger' : e.mine || waiting ? 'primary' : 'default'}
        accessibilityLiveRegion="polite"
      >
        {eventStatus(e, t)}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {!cancelled && !e.mine && !waiting && !e.full ? (
        <Button
          label={t('events.going')}
          loading={rsvp.isPending}
          onPress={() => answer('going')}
        />
      ) : null}
      {!cancelled && !e.mine && !waiting && e.full ? (
        <Button
          label={t('events.waitlistJoin')}
          hint={t('events.waitlistHint')}
          loading={rsvp.isPending}
          onPress={() => answer('waitlist')}
        />
      ) : null}
      {!cancelled && (e.full || waiting) && !e.mine ? (
        <AppText variant="caption" tone="muted">
          {t('events.waitlistHint')}
        </AppText>
      ) : null}
      {!cancelled && waiting ? (
        <Button
          variant="secondary"
          label={t('events.waitlistLeave')}
          loading={rsvp.isPending}
          onPress={() => answer('leave')}
        />
      ) : null}
      {!cancelled && e.mine ? (
        <Button
          variant="secondary"
          label={t('events.notGoing')}
          loading={rsvp.isPending}
          onPress={() => answer('leave')}
        />
      ) : null}
      <Banner tone="info" message={t('events.privacy')} />
    </Screen>
  );
}

export default function EventRoute() {
  return (
    <RequireSession>
      <EventScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
});
