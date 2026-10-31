// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { AskProfileAnswer, AskProfileState, Locale } from '@nexaheart/shared';
import { MAX_PROFILE_QUESTION } from '@nexaheart/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { apiFetch, ApiRequestError, json } from '../lib/api';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { TextField } from './TextField';

/**
 * Phase 75b: ask about a profile. The answer comes only from what they made public (not the
 * sensitive parts), and nothing is stored. Hidden where the community has no text AI, or where
 * the other person hasn't agreed to an external one.
 */
export function AskProfile({ id, name }: { id: string; name: string }) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ q: string; a: string | null }>();
  const [error, setError] = useState<string>();
  const state = useQuery({
    queryKey: ['ask-profile', id],
    queryFn: () => apiFetch<AskProfileState>(`/v1/profiles/${id}/ask`),
  });
  const ask = useMutation({
    mutationFn: (q: string) =>
      apiFetch<AskProfileAnswer>(`/v1/profiles/${id}/ask`, {
        method: 'POST',
        body: json({ question: q, locale: i18n.language as Locale }),
      }),
  });

  const s = state.data?.state;
  if (!s || s === 'unavailable') return null;
  const send = () => {
    const q = question.trim();
    if (q.length < 3) return;
    setError(undefined);
    ask.mutate(q, {
      onSuccess: (r) => {
        setAnswer({ q, a: r.answer });
        setQuestion('');
      },
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.status === 429
            ? t('ask.limit')
            : t('common.genericError'),
        ),
    });
  };

  return (
    <View
      style={[styles.box, { backgroundColor: colors.surface }]}
      accessibilityRole="summary"
      testID="ask-profile"
    >
      <AppText variant="heading">{t('ask.title', { name })}</AppText>
      {s === 'needs_consent' ? (
        <>
          <AppText variant="body" tone="muted">
            {t('ask.needsConsent')}
          </AppText>
          <Button
            variant="secondary"
            label={t('ask.settings')}
            onPress={() => router.push('/settings')}
          />
        </>
      ) : (
        <>
          <AppText variant="caption" tone="muted">
            {t('ask.hint')}
          </AppText>
          <TextField
            label={t('ask.label')}
            value={question}
            onChangeText={setQuestion}
            maxLength={MAX_PROFILE_QUESTION}
            placeholder={t('ask.placeholder')}
            onSubmitEditing={send}
            {...(error ? { error } : {})}
          />
          <Button
            label={t('ask.send')}
            loading={ask.isPending}
            disabled={question.trim().length < 3}
            onPress={send}
          />
          {answer ? (
            <View
              style={[styles.answer, { borderColor: colors.border }]}
              accessibilityLiveRegion="polite"
              testID="ask-answer"
            >
              <AppText variant="label" userContent>
                {answer.q}
              </AppText>
              <AppText variant="body" userContent={answer.a !== null}>
                {answer.a ?? t('ask.notSaid', { name })}
              </AppText>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  answer: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
