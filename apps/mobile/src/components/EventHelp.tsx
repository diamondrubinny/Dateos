// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_EVENT_QUESTION_LENGTH } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useAskOrganizers } from '../lib/event-queries';
import { useInstance } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { TextField } from './TextField';

/**
 * "I need help now" during an event (phase 71c): an urgent message to the organizers, who see it
 * first and are told at once; like any question, they don't see who wrote it. Anything serious goes
 * to emergency services first.
 */
export function EventHelp({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const instance = useInstance();
  const ask = useAskOrganizers(eventId);
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string }>();
  const resources = Boolean(instance.data?.community.safetyResources);

  const send = () => {
    setResult(undefined);
    ask.mutate(
      { body: text.trim(), urgent: true },
      {
        onSuccess: () => {
          setText('');
          setResult({ tone: 'success', text: t('eventHelp.sent') });
        },
        onError: (e) =>
          setResult({
            tone: 'error',
            text:
              e instanceof ApiRequestError && e.status === 429
                ? t('eventHelp.tooMany')
                : e instanceof ApiRequestError && e.status === 422
                  ? t('eventBoard.rephrase')
                  : t('common.genericError'),
          }),
      },
    );
  };

  return (
    <View
      testID="event-help"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.danger }]}
    >
      <AppText variant="heading" accessibilityRole="header">
        🆘 {t('eventHelp.title')}
      </AppText>
      <AppText variant="body">{t('eventHelp.intro')}</AppText>
      <AppText variant="caption" tone="muted">
        {t('eventHelp.emergency')}
      </AppText>
      {resources ? (
        <Button
          variant="ghost"
          label={t('eventHelp.resources')}
          onPress={() => router.push('/help-near-you')}
        />
      ) : null}
      {result ? <Banner tone={result.tone} message={result.text} /> : null}
      <TextField
        label={t('eventHelp.label')}
        hint={t('eventHelp.hint')}
        value={text}
        onChangeText={(v) => setText(v.slice(0, MAX_EVENT_QUESTION_LENGTH))}
        multiline
        maxLength={MAX_EVENT_QUESTION_LENGTH}
      />
      <Button
        label={t('eventHelp.send')}
        disabled={text.trim().length === 0}
        loading={ask.isPending}
        onPress={send}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm, borderWidth: 2 },
});
