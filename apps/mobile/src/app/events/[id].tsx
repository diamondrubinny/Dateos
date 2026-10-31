// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { CHECK_IN_EARLY_MINUTES } from '@nexaheart/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { EventBoard } from '../../components/EventBoard';
import { EventMisses } from '../../components/EventMisses';
import { eventStatus, formatEventTime } from '../../components/EventCard';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { ApiRequestError } from '../../lib/api';
import { addToCalendar } from '../../lib/calendar';
import { useCheckIn, useEvent, useEventMisses, useRsvp } from '../../lib/event-queries';
import { useLocale } from '../../lib/locale';
import { radius, spacing, useColors } from '../../lib/theme';

function EventScreen() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const { id, code: linkCode } = useLocalSearchParams<{ id: string; code?: string }>();
  const event = useEvent(id);
  const rsvp = useRsvp(id);
  const checkIn = useCheckIn(id);
  const misses = useEventMisses();
  const [error, setError] = useState<string>();
  // The QR code at the venue opens this page with its code: it's filled in, not sent by itself.
  const [code, setCode] = useState(/^\d{6}$/.test(linkCode ?? '') ? linkCode! : '');
  const [checkInError, setCheckInError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

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
      onError: (err) => {
        // Phase 71a: a 409 is either a full event or new places paused after missed events.
        if (err instanceof ApiRequestError && err.status === 409) {
          void misses
            .refetch()
            .then((r) =>
              setError(r.data?.pausedUntil ? t('eventMisses.refused') : t('events.fullNow')),
            );
          return;
        }
        setError(t('common.genericError'));
      },
    });
  };

  const start = Date.parse(e.startsAt);
  const end = Date.parse(e.endsAt);
  const checkInOpen =
    !cancelled && e.mine && now >= start - CHECK_IN_EARLY_MINUTES * 60_000 && now <= end;
  const speedOpen =
    !cancelled && e.mine && e.kind === 'speed' && now >= start - 15 * 60_000 && now < end;
  const submitCheckIn = () => {
    setCheckInError(undefined);
    checkIn.mutate(code, {
      onError: (err) =>
        setCheckInError(
          err instanceof ApiRequestError && err.status === 422
            ? t('events.checkInWrong')
            : err instanceof ApiRequestError && err.status === 409
              ? t('events.checkInClosed')
              : err instanceof ApiRequestError && err.status === 429
                ? t('events.checkInLimit')
                : t('common.genericError'),
        ),
    });
  };

  return (
    <Screen back title={e.title}>
      {cancelled ? <Banner tone="error" message={t('events.cancelledBody')} /> : null}
      {e.kind === 'speed' ? (
        <AppText variant="label" tone="primary" testID="speed-label">
          🎥 {t('events.speedLabel', { minutes: e.roundMinutes ?? 5 })}
        </AppText>
      ) : null}
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
      {!e.mine && !waiting && now < end ? <EventMisses /> : null}
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
      {!cancelled && e.mine && now < end ? (
        <Button
          variant="secondary"
          label={t('calendar.add')}
          hint={t('calendar.eventHint')}
          onPress={() =>
            void addToCalendar(
              {
                uid: `event-${e.id}@local`,
                start: new Date(e.startsAt),
                end: new Date(e.endsAt),
                title: e.title,
                ...(e.venue
                  ? {
                      location: [e.venue.name, e.venue.address].filter(Boolean).join(', '),
                    }
                  : {}),
              },
              'event',
            ).then((ok) => (ok ? undefined : setError(t('calendar.failed'))))
          }
        />
      ) : null}
      {!cancelled && e.mine && now < end ? (
        <Button
          variant="secondary"
          label={t('events.notGoing')}
          loading={rsvp.isPending}
          onPress={() => answer('leave')}
        />
      ) : null}
      {e.kind === 'speed' && !cancelled ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <AppText variant="body">{t('events.speedHint')}</AppText>
          {speedOpen ? (
            <Button
              label={t('events.speedEnter')}
              onPress={() => router.push({ pathname: '/speed/[id]', params: { id } })}
            />
          ) : e.mine ? (
            <AppText variant="caption" tone="muted">
              {t('events.speedLater')}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {e.checkedIn ? (
        <AppText
          variant="label"
          tone="success"
          testID="checked-in"
          accessibilityLiveRegion="polite"
        >
          ✓ {t('events.checkedIn')}
        </AppText>
      ) : checkInOpen ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]} testID="check-in">
          <AppText variant="heading" accessibilityRole="header">
            {t('events.checkInTitle')}
          </AppText>
          <AppText variant="body" tone="muted" nativeID="check-in-hint">
            {t('events.checkInHint')}
          </AppText>
          <AppText variant="label" nativeID="check-in-label">
            {t('events.checkInCode')}
          </AppText>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            accessibilityLabel={t('events.checkInCode')}
            accessibilityLabelledBy="check-in-label"
            aria-describedby="check-in-hint"
            style={[
              styles.code,
              {
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.background,
              },
            ]}
          />
          {checkInError ? <Banner tone="error" message={checkInError} /> : null}
          <Button
            label={t('events.checkInButton')}
            disabled={code.length !== 6}
            loading={checkIn.isPending}
            onPress={submitCheckIn}
          />
        </View>
      ) : null}
      {e.meetAgainUntil ? (
        // Phase 71a: after an in-person event I checked in at.
        <View style={[styles.card, { backgroundColor: colors.primarySoft }]} testID="meet-again">
          <AppText variant="heading" accessibilityRole="header">
            {t('meetAgain.title')}
          </AppText>
          <AppText variant="body">{t('meetAgain.teaser')}</AppText>
          <Button
            label={t('meetAgain.open')}
            onPress={() => router.push({ pathname: '/events/meet-again/[id]', params: { id } })}
          />
        </View>
      ) : null}
      {e.mine || waiting ? (
        // Phase 27: updates and questions, only for people going or waiting.
        <EventBoard eventId={id} open={!cancelled && now < end} />
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
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  code: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 24,
    letterSpacing: 6,
    textAlign: 'center',
    writingDirection: 'ltr',
  },
});
