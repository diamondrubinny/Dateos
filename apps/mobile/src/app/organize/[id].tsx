// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_EVENT_ANSWER_LENGTH, MAX_EVENT_UPDATE_LENGTH } from '@nexaheart/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { formatEventTime } from '../../components/EventCard';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import {
  useEvent,
  useOrganizerBoard,
  useOrganizerBoardAction,
  useOrganizerCheckIn,
} from '../../lib/event-queries';
import { useLocale } from '../../lib/locale';
import { radius, spacing, useColors } from '../../lib/theme';

/**
 * Running my own event as a community organizer (phase 71e): updates to everyone going, answers to
 * questions (without seeing who asked), and the check-in code to show at the door.
 */
function RunEvent() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const board = useOrganizerBoard(id);
  const action = useOrganizerBoardAction(id);
  const [showCode, setShowCode] = useState(false);
  const code = useOrganizerCheckIn(id, showCode);
  const [update, setUpdate] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  if (board.isPending || event.isPending) return <Loading />;
  if (!board.data || !event.data) {
    return (
      <Screen back title={t('organize.title')}>
        <Banner tone="error" message={t('common.genericError')} />
      </Screen>
    );
  }
  const e = event.data;
  const done = (text: string) => ({
    onSuccess: () => setMessage({ tone: 'success' as const, text }),
    onError: () => setMessage({ tone: 'error' as const, text: t('common.genericError') }),
  });

  return (
    <Screen back title={e.title}>
      <AppText variant="body">
        {formatEventTime(e, locale)} · {t('events.goingCount', { count: e.going })}
      </AppText>
      {message ? <Banner tone={message.tone} message={message.text} /> : null}

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <AppText variant="heading" accessibilityRole="header">
          {t('organize.checkIn')}
        </AppText>
        {showCode && code.data ? (
          <AppText variant="title" testID="organizer-code" selectable>
            {code.data.code}
          </AppText>
        ) : (
          <Button
            variant="secondary"
            label={t('organize.showCode')}
            onPress={() => setShowCode(true)}
          />
        )}
        <AppText variant="caption" tone="muted">
          {t('organize.codeHint')}
        </AppText>
      </View>

      <AppText variant="heading" accessibilityRole="header">
        {t('organize.updates')}
      </AppText>
      <TextField
        label={t('organize.update')}
        value={update}
        onChangeText={(v) => setUpdate(v.slice(0, MAX_EVENT_UPDATE_LENGTH))}
        multiline
        maxLength={MAX_EVENT_UPDATE_LENGTH}
      />
      <Button
        label={t('organize.post')}
        disabled={update.trim().length === 0}
        loading={action.isPending}
        onPress={() =>
          action.mutate(
            { update: update.trim() },
            {
              ...done(t('organize.posted')),
              onSuccess: () => {
                setUpdate('');
                setMessage({ tone: 'success', text: t('organize.posted') });
              },
            },
          )
        }
      />
      {board.data.updates.map((u) => (
        <AppText key={u.id} variant="body" userContent>
          📣 {u.body}
        </AppText>
      ))}

      <AppText variant="heading" accessibilityRole="header">
        {t('organize.questions')}
      </AppText>
      <AppText variant="caption" tone="muted">
        {t('organize.questionsHint')}
      </AppText>
      {board.data.questions.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('organize.noQuestions')}
        </AppText>
      ) : null}
      <View role="list" style={styles.list}>
        {board.data.questions.map((q) => (
          <View
            key={q.id}
            role="listitem"
            style={[styles.card, { backgroundColor: colors.surface }]}
          >
            {q.urgent ? (
              <AppText variant="caption" tone="danger">
                🆘 {t('eventHelp.badge')}
              </AppText>
            ) : null}
            <AppText variant="label" userContent>
              {q.body}
            </AppText>
            {q.answer ? (
              <AppText variant="body" userContent>
                {t('eventBoard.answer')} {q.answer}
              </AppText>
            ) : (
              <>
                <TextField
                  label={t('organize.answer')}
                  value={answers[q.id] ?? ''}
                  onChangeText={(v) =>
                    setAnswers({ ...answers, [q.id]: v.slice(0, MAX_EVENT_ANSWER_LENGTH) })
                  }
                  multiline
                  maxLength={MAX_EVENT_ANSWER_LENGTH}
                />
                <Button
                  variant="secondary"
                  label={t('organize.sendAnswer')}
                  disabled={(answers[q.id] ?? '').trim().length === 0}
                  onPress={() =>
                    action.mutate(
                      { questionId: q.id, answer: (answers[q.id] ?? '').trim() },
                      done(t('organize.answered')),
                    )
                  }
                />
              </>
            )}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});

export default function RunEventRoute() {
  return (
    <RequireSession>
      <RunEvent />
    </RequireSession>
  );
}
