// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  againAnswers,
  DATE_CALENDAR_HOURS,
  type AgainAnswer,
  type MessageView,
} from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { addToCalendar } from '../lib/calendar';
import { useDateAction, useDateFeedback } from '../lib/date-queries';
import { useLocale } from '../lib/locale';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { ChoiceGroup } from './Choice';

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
export function DateCard({
  message,
  other,
}: {
  message: MessageView;
  other?: { id: string; name: string } | undefined;
}) {
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
            {/* Phase 42: discreet on purpose, calendars sync and show on lock screens. */}
            <Button
              variant="secondary"
              label={t('calendar.add')}
              hint={t('calendar.dateHint')}
              onPress={() =>
                void addToCalendar(
                  {
                    uid: `date-${plan.id}@local`,
                    start: new Date(plan.startsAt),
                    end: new Date(Date.parse(plan.startsAt) + DATE_CALENDAR_HOURS * 3_600_000),
                    title: t('calendar.dateTitle', { place: plan.venue.name }),
                    location: [plan.venue.name, plan.venue.address].filter(Boolean).join(', '),
                  },
                  'date',
                ).then((ok) => (ok ? undefined : setError(t('calendar.failed'))))
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
        {plan.status === 'accepted' && plan.feedback?.canGive ? (
          <DateFeedback message={message} other={other} />
        ) : null}
      </View>
    </View>
  );
}

/**
 * "Did you meet?" (phase 20). The answers are private: the other person only ever sees "you both
 * want to meet again", and only when both said so.
 */
function DateFeedback({
  message,
  other,
}: {
  message: MessageView;
  other?: { id: string; name: string } | undefined;
}) {
  const { t } = useTranslation();
  const send = useDateFeedback(message.matchId);
  const plan = message.date!;
  const feedback = plan.feedback!;
  const [editing, setEditing] = useState(false);
  const [met, setMet] = useState<boolean>();
  const [error, setError] = useState<string>();

  const save = (input: { met: boolean; again: AgainAnswer | null }) =>
    send.mutate(
      { id: plan.id, ...input },
      {
        onSuccess: () => {
          setEditing(false);
          setMet(undefined);
          setError(undefined);
        },
        onError: () => setError(t('common.genericError')),
      },
    );

  const asking = feedback.mine === null || editing;
  return (
    <View style={styles.feedback} testID="date-feedback">
      {feedback.bothAgain ? (
        <AppText variant="heading" tone="success" accessibilityRole="header">
          {t('feedback.bothAgain')}
        </AppText>
      ) : null}
      {error ? <Banner tone="error" message={error} /> : null}
      {asking && met === undefined ? (
        <>
          <AppText variant="heading">{t('feedback.didYouMeet')}</AppText>
          <AppText variant="caption" tone="muted">
            {t('feedback.private')}
          </AppText>
          <View style={styles.actions}>
            <Button label={t('feedback.metYes')} onPress={() => setMet(true)} />
            <Button
              variant="secondary"
              label={t('feedback.metNo')}
              loading={send.isPending}
              onPress={() => save({ met: false, again: null })}
            />
          </View>
        </>
      ) : null}
      {asking && met === true ? (
        <ChoiceGroup
          label={t('feedback.again')}
          options={againAnswers.map((value) => ({
            value,
            label: t(`feedback.againOptions.${value}`),
          }))}
          selected={[]}
          onChange={(next) => next[0] && save({ met: true, again: next[0] })}
        />
      ) : null}
      {!asking && feedback.mine ? (
        <>
          <AppText variant="body" accessibilityLiveRegion="polite">
            {feedback.mine.met
              ? t('feedback.savedMet', {
                  again: feedback.mine.again
                    ? t(`feedback.againOptions.${feedback.mine.again}`)
                    : '',
                })
              : t('feedback.savedNotMet')}
          </AppText>
          <Button variant="ghost" label={t('feedback.change')} onPress={() => setEditing(true)} />
        </>
      ) : null}
      {other ? (
        <Button
          variant="ghost"
          label={t('feedback.feltWrong')}
          hint={t('feedback.feltWrongHint')}
          onPress={() =>
            router.push({
              pathname: '/report/[id]',
              params: { id: other.id, name: other.name, matchId: message.matchId },
            })
          }
        />
      ) : null}
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
  feedback: { gap: spacing.sm, marginTop: spacing.sm },
});
