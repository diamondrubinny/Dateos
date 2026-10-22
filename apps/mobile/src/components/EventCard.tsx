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
  return `${day}, ${time.format(new Date(event.startsAt))}–${time.format(new Date(event.endsAt))}`;
}

/** The status line of an event: going, full, cancelled, or how many are going. */
export function eventStatus(event: CommunityEvent, t: TFunction) {
  if (event.status === 'cancelled') return t('events.cancelled');
  if (event.mine) return t('events.youreGoing', { count: event.going });
  if (event.full) return t('events.full');
  return t('events.goingCount', { count: event.going });
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
      <AppText variant="body">{formatEventTime(event, locale)}</AppText>
      {event.venue ? (
        <AppText variant="body" tone="muted" userContent>
          {t('datePlan.placeWithArea', { name: event.venue.name, area: event.venue.area })}
          {event.venue.stepFree ? ` · ♿ ${t('datePlan.stepFree')}` : ''}
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
