// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_VOICE_SECONDS } from '@nexaheart/shared';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { formatSeconds } from './VoicePlayer';

export interface Recording {
  uri: string;
  durationMs: number;
}

/**
 * Tap to start, tap to stop, then send or discard. Every step is a regular button, so it works
 * with screen readers, switch control and keyboards (no press-and-hold).
 */
export function VoiceRecorder({
  onSend,
  onClose,
  sending,
}: {
  onSend: (recording: Recording) => void;
  onClose: () => void;
  sending: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [result, setResult] = useState<Recording>();
  const [error, setError] = useState<string>();

  const stop = async () => {
    const duration = state.durationMillis;
    await recorder.stop();
    if (recorder.uri) setResult({ uri: recorder.uri, durationMs: duration });
  };

  // Hard limit, matching the server.
  useEffect(() => {
    if (state.isRecording && state.durationMillis >= MAX_VOICE_SECONDS * 1000) void stop();
  });

  const start = async () => {
    setError(undefined);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return setError(t('voice.permission'));
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    setResult(undefined);
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const cancel = async () => {
    if (state.isRecording) await recorder.stop();
    onClose();
  };

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText variant="label" accessibilityLiveRegion="polite">
        {state.isRecording
          ? t('voice.recording', {
              time: formatSeconds(state.durationMillis),
              max: formatSeconds(MAX_VOICE_SECONDS * 1000),
            })
          : result
            ? t('voice.ready', { time: formatSeconds(result.durationMs) })
            : t('voice.intro', { max: MAX_VOICE_SECONDS })}
      </AppText>
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      <View style={styles.actions}>
        {state.isRecording ? (
          <Button variant="danger" label={t('voice.stop')} onPress={() => void stop()} />
        ) : result ? (
          <>
            <Button label={t('voice.send')} loading={sending} onPress={() => onSend(result)} />
            <Button variant="secondary" label={t('voice.again')} onPress={() => void start()} />
          </>
        ) : (
          <Button label={t('voice.start')} onPress={() => void start()} />
        )}
        <Button variant="ghost" label={t('common.cancel')} onPress={() => void cancel()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderRadius: radius.md },
  actions: { gap: spacing.sm },
});
