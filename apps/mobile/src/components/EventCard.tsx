// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { CommunityEvent } from '@nexaheart/shared';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useEvents } from '../lib/event-queries';
import { useLocale } from '../lib/locale';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

export function formatEventTime(
  event: Pick<CommunityEvent, 'startsAt' | 'endsAt'>,
  locale: string,
) {
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(event.startsAt));
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  // The range is isolated left-to-right, so "05:30–06:30" isn't flipped in Hebrew or Arabic.
  const range = `${time.format(new Date(event.startsAt))}–${time.format(new Date(event.endsAt))}`;
  return `${day}, \u2066${range}\u2069`;
}

/** The status line of an event: going, full, cancelled, or how many are going. */
export function eventStatus(event: CommunityEvent, t: TFunction) {
  if (event.status === 'cancelled') return t('events.cancelled');
  if (event.meetAgainUntil) return t('meetAgain.listStatus');
  if (event.mine) return t('events.youreGoing', { count: event.going });
  if (event.waitingAhead !== null) return t('events.waiting', { count: event.waitingAhead });
  if (event.full && event.waitingCount > 0)
    return t('events.fullWaiting', { count: event.waitingCount });
  if (event.full) return t('events.full');
  return t('events.goingCount', { count: event.going });
}

/** Phase 71b: "For women · 25–35", or null for everyone. */
export function eventAudience(event: CommunityEvent, t: TFunction): string | null {
  const { genders, ageMin, ageMax, faithStreams } = event.audience;
  const groups = event.pools ? event.pools.map((p) => p.gender) : genders;
  const parts: string[] = [];
  if (groups.length > 0) parts.push(groups.map((g) => t(`eventGroups.genders.${g}`)).join(', '));
  if (ageMin !== null || ageMax !== null) {
    parts.push(t('eventGroups.ages', { min: ageMin ?? 18, max: ageMax ?? 99 }));
  }
  if (faithStreams.length > 0) {
    parts.push(faithStreams.map((s) => t(`faith.streams.${s}`, { defaultValue: s })).join(', '));
  }
  return parts.length > 0 ? t('eventGroups.audience', { who: parts.join(' · ') }) : null;
}

/** Phase 71b: places left in each group ("Women: 3 places left", "Men: full"). */
export function eventPools(event: CommunityEvent, t: TFunction): string[] {
  return (event.pools ?? []).map((p) => {
    const group = t(`eventGroups.groups.${p.gender}`);
    const left = p.capacity - p.going;
    return left > 0
      ? t('eventGroups.placesLeft', { group, count: left })
      : t('eventGroups.groupFull', { group });
  });
}

export function EventCard({ event }: { event: CommunityEvent }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const cancelled = event.status === 'cancelled';
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/events/[id]', params: { id: event.id } })}
      style={[
        styles.card,
        {
          backgroundColor: event.mine && !cancelled ? colors.primarySoft : colors.surface,
          borderColor: event.mine && !cancelled ? colors.primary : colors.border,
          opacity: cancelled ? 0.75 : 1,
        },
      ]}
    >
      <AppText variant="heading" userContent>
        {event.title}
      </AppText>
      {event.kind === 'speed' ? (
        <AppText variant="label" tone="primary">
          🎥 {t('events.speedLabel', { minutes: event.roundMinutes ?? 5 })}
        </AppText>
      ) : null}
      <AppText variant="body">{formatEventTime(event, locale)}</AppText>
      {event.venue ? (
        <AppText variant="body" tone="muted" userContent>
          {t('datePlan.placeWithArea', { name: event.venue.name, area: event.venue.area })}
          {event.venue.stepFree ? ` · ♿ ${t('datePlan.stepFree')}` : ''}
        </AppText>
      ) : null}
      {eventAudience(event, t) ? (
        <AppText variant="caption" tone="muted">
          {eventAudience(event, t)}
        </AppText>
      ) : null}
      <AppText variant="label" tone={cancelled ? 'danger' : event.mine ? 'primary' : 'default'}>
        {eventStatus(event, t)}
      </AppText>
    </Pressable>
  );
}

/** A way into community events from the chats list, shown only when there are upcoming ones. */
export function EventsEntry() {
  const { t } = useTranslation();
  const colors = useColors();
  const events = useEvents().data ?? [];
  const upcoming = events.filter((e) => e.status === 'scheduled');
  if (upcoming.length === 0) return null;
  const mine = upcoming.filter((e) => e.mine).length;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push('/events')}
      style={[styles.entry, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <AppText variant="label">🎉 {t('events.entry', { count: upcoming.length })}</AppText>
      {mine > 0 ? (
        <AppText variant="caption" tone="primary">
          {t('events.entryMine', { count: mine })}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    gap: spacing.xs,
    minHeight: MIN_TOUCH,
  },
  entry: {
    minHeight: MIN_TOUCH,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
});

export const eventStyles = StyleSheet.create({ list: { gap: spacing.md } });
export const EventList = ({ events }: { events: CommunityEvent[] }) => (
  <View style={eventStyles.list}>
    {events.map((e) => (
      <EventCard key={e.id} event={e} />
    ))}
  </View>
);
