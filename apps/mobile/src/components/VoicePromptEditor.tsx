// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_VOICE_PROMPT_SECONDS, promptKeys, type PromptKey } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useMe, useRemoveVoicePrompt, useSetVoicePrompt } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { ChoiceGroup } from './Choice';
import { VoicePlayer } from './VoicePlayer';
import { VoiceRecorder } from './VoiceRecorder';

/** About me → voice prompt (phase 19): answer one prompt out loud, up to 30 seconds. */
export function VoicePromptEditor() {
  const { t } = useTranslation();
  const colors = useColors();
  const current = useMe().data?.voicePrompt ?? null;
  const upload = useSetVoicePrompt();
  const remove = useRemoveVoicePrompt();
  const [promptKey, setPromptKey] = useState<PromptKey>(current?.promptKey ?? promptKeys[0]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(false);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="voice-prompt">
      <AppText variant="heading">{t('voicePrompt.title')}</AppText>
      <AppText variant="body" tone="muted">
        {t('voicePrompt.hint', { max: MAX_VOICE_PROMPT_SECONDS })}
      </AppText>
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {current?.status === 'rejected' ? (
        <Banner tone="error" message={t('voicePrompt.rejected')} />
      ) : null}
      {current && (current.status === 'quarantine' || current.status === 'processing') ? (
        <Banner tone="info" message={t('voicePrompt.processing')} />
      ) : null}
      {current?.status === 'clean' ? (
        <View style={styles.current}>
          <AppText variant="caption" tone="muted">
            {t(`prompt.${current.promptKey}`)}
          </AppText>
          <VoicePlayer
            path={`/v1/audio/${current.audioId}`}
            durationMs={current.durationMs}
            onPrimary={false}
          />
        </View>
      ) : null}
      {recording ? (
        <VoiceRecorder
          maxSeconds={MAX_VOICE_PROMPT_SECONDS}
          sendLabel={t('voicePrompt.save')}
          introLabel={t('voicePrompt.intro', {
            prompt: t(`prompt.${promptKey}`),
            max: MAX_VOICE_PROMPT_SECONDS,
          })}
          sending={upload.isPending}
          onClose={() => setRecording(false)}
          onSend={(r) => {
            setError(false);
            upload.mutate(
              { uri: r.uri, promptKey },
              { onSuccess: () => setRecording(false), onError: () => setError(true) },
            );
          }}
        />
      ) : (
        <>
          <ChoiceGroup
            label={t('voicePrompt.which')}
            stacked
            options={promptKeys.map((value) => ({ value, label: t(`prompt.${value}`) }))}
            selected={[promptKey]}
            onChange={(next) => setPromptKey((next[0] as PromptKey | undefined) ?? promptKey)}
          />
          <Button
            variant="secondary"
            label={current ? t('voicePrompt.again') : t('voicePrompt.record')}
            onPress={() => setRecording(true)}
          />
          {current ? (
            <Button
              variant="dangerGhost"
              label={t('voicePrompt.remove')}
              loading={remove.isPending}
              onPress={() => remove.mutate(undefined, { onError: () => setError(true) })}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  current: { gap: spacing.xs },
});
