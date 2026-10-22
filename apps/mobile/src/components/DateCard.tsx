import type { MessageView } from '@dateos/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useDateAction } from '../lib/date-queries';
import { useLocale } from '../lib/locale';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** A date idea in the chat: the place (a copy kept with the idea), the time, and what to do next. */
export function DateCard({ message }: { message: MessageView }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const action = useDateAction(message.matchId);
  const [error, setError] = useState<string>();
  const plan = message.date;
  if (!plan) return null;

  const upcoming = Date.parse(plan.startsAt) > Date.now();
  const run = (kind: 'accept' | 'decline' | 'cancel') =>
    action.mutate(
      { id: plan.id, action: kind },
      {
        onSuccess: () => setError(undefined),
        onError: (e) =>
          setError(
            e instanceof ApiRequestError && e.status === 409
              ? t('datePlan.changed')
              : t('common.genericError'),
          ),
      },
    );

  const title =
    plan.status === 'accepted'
      ? t('datePlan.accepted')
      : plan.status === 'declined'
        ? t('datePlan.declined')
        : plan.status === 'cancelled'
          ? t('datePlan.cancelled')
          : plan.mine
            ? t('datePlan.yourIdea')
            : t('datePlan.theirIdea');
  const closed = plan.status === 'declined' || plan.status === 'cancelled';

  return (
    <View
      style={[styles.row, message.mine ? styles.rowMine : styles.rowTheirs]}
      accessibilityRole="summary"
    >
      {message.scam.length > 0 ? <Banner tone="error" message={t('chat.scamBody')} /> : null}
      <View
        style={[
          styles.card,
          {
            backgroundColor: plan.status === 'accepted' ? colors.successSoft : colors.surface,
            borderColor: plan.status === 'accepted' ? colors.success : colors.border,
            opacity: closed ? 0.75 : 1,
          },
        ]}
      >
        <AppText variant="label" tone={plan.status === 'accepted' ? 'success' : 'primary'}>
          📅 {title}
        </AppText>
        <AppText variant="heading" userContent>
          {plan.venue.name}
        </AppText>
        <AppText variant="body" tone="muted" userContent>
          {plan.venue.area} · {t(`datePlan.categories.${plan.venue.category}`)}
          {plan.venue.stepFree ? ` · ♿ ${t('datePlan.stepFree')}` : ''}
        </AppText>
        <AppText variant="body">{formatDateTime(plan.startsAt, locale)}</AppText>
        <AppText variant="caption" tone="muted" userContent selectable>
          {plan.venue.address}
        </AppText>
        {plan.venue.note ? (
          <AppText variant="caption" tone="muted" userContent>
            {plan.venue.note}
          </AppText>
        ) : null}
        {plan.note ? (
          <AppText variant="body" userContent>
            {t('ghosting.quote', { message: plan.note })}
          </AppText>
        ) : null}

        {error ? <Banner tone="error" message={error} /> : null}

        {plan.status === 'proposed' && !plan.mine && upcoming ? (
          <View style={styles.actions}>
            <Button
              label={t('datePlan.accept')}
              loading={action.isPending && action.variables?.action === 'accept'}
              onPress={() => run('accept')}
            />
            <Button
              variant="secondary"
              label={t('datePlan.decline')}
              loading={action.isPending && action.variables?.action === 'decline'}
              onPress={() => run('decline')}
            />
          </View>
        ) : null}
        {plan.status === 'proposed' && plan.mine ? (
          <View style={styles.actions}>
            <AppText variant="caption" tone="muted">
              {t('datePlan.waiting')}
            </AppText>
            <Button
              variant="ghost"
              label={t('datePlan.withdraw')}
              loading={action.isPending}
              onPress={() => run('cancel')}
            />
          </View>
        ) : null}
        {plan.status === 'accepted' && upcoming ? (
          <View style={styles.actions}>
            <Button
              label={t('datePlan.checkin')}
              onPress={() =>
                router.push({
                  pathname: '/checkin',
                  params: {
                    matchId: message.matchId,
                    place: t('datePlan.placeWithArea', {
                      name: plan.venue.name,
                      area: plan.venue.area,
                    }),
                    startsAt: plan.startsAt,
                  },
                })
              }
            />
            <Button
              variant="ghost"
              label={t('datePlan.cancelDate')}
              loading={action.isPending}
              onPress={() => run('cancel')}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, marginVertical: spacing.xs },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  card: {
    width: '88%',
    maxWidth: 420,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    gap: spacing.xs,
  },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
