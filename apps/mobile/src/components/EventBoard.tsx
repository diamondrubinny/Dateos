// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_EVENT_QUESTION_LENGTH } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useAskOrganizers, useDeleteQuestion, useEventBoard } from '../lib/event-queries';
import { useLocale } from '../lib/locale';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { TextField } from './TextField';

const when = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/**
 * Updates from the organizers and private questions to them (phase 27), for people going or
 * waiting. Nobody sees who else is going or asking.
 */
export function EventBoard({ eventId, open }: { eventId: string; open: boolean }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const board = useEventBoard(eventId, true);
  const ask = useAskOrganizers(eventId);
  const remove = useDeleteQuestion(eventId);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  if (!board.data) return null;
  const { updates, questions } = board.data;

  const send = () => {
    setError(undefined);
    setSent(false);
    ask.mutate(question.trim(), {
      onSuccess: () => {
        setQuestion('');
        setSent(true);
      },
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.status === 422
            ? t('eventBoard.rephrase')
            : e instanceof ApiRequestError && e.status === 429
              ? t('eventBoard.tooMany')
              : t('common.genericError'),
        ),
    });
  };

  return (
    <View style={styles.wrap} testID="event-board">
      <AppText variant="heading">{t('eventBoard.updatesTitle')}</AppText>
      {updates.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('eventBoard.noUpdates')}
        </AppText>
      ) : (
        <View role="list" style={styles.list}>
          {updates.map((u) => (
            <View
              key={u.id}
              role="listitem"
              style={[styles.card, { backgroundColor: colors.primarySoft }]}
            >
              <AppText variant="caption" tone="muted">
                📣 {when(u.createdAt, locale)}
              </AppText>
              <AppText variant="body" userContent>
                {u.body}
              </AppText>
            </View>
          ))}
        </View>
      )}

      <AppText variant="heading">{t('eventBoard.askTitle')}</AppText>
      <AppText variant="body" tone="muted">
        {t('eventBoard.askHint')}
      </AppText>
      {questions.length > 0 ? (
        <View role="list" style={styles.list}>
          {questions.map((q) => (
            <View
              key={q.id}
              role="listitem"
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
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
                <AppText variant="caption" tone="muted">
                  {t('eventBoard.waiting')}
                </AppText>
              )}
              <Button
                variant="ghost"
                label={t('eventBoard.delete')}
                hint={q.body}
                loading={remove.isPending && remove.variables === q.id}
                onPress={() => remove.mutate(q.id)}
              />
            </View>
          ))}
        </View>
      ) : null}
      {open ? (
        <>
          {error ? <Banner tone="error" message={error} /> : null}
          {sent ? <Banner tone="success" message={t('eventBoard.sent')} /> : null}
          <TextField
            label={t('eventBoard.question')}
            value={question}
            onChangeText={(v) => setQuestion(v.slice(0, MAX_EVENT_QUESTION_LENGTH))}
            multiline
            maxLength={MAX_EVENT_QUESTION_LENGTH}
          />
          <Button
            label={t('eventBoard.send')}
            disabled={question.trim().length === 0}
            loading={ask.isPending}
            onPress={send}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  list: { gap: spacing.sm },
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs, borderWidth: 0 },
});
