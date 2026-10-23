// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRequestTranscript, useTranscript } from '../lib/chat-queries';
import { useInstance, useMe } from '../lib/queries';
import { MIN_TOUCH, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/**
 * "Show text" under a voice message or voice prompt (phase 26). The text is made on the community's
 * own server only when asked; someone who shared "deaf or hard of hearing" gets it by itself.
 */
export function VoiceTranscript({ path, onPrimary }: { path: string; onPrimary: boolean }) {
  const { t } = useTranslation();
  const colors = useColors();
  const enabled = useInstance().data?.transcripts === true;
  const automatic = useMe().data?.accessNeeds.needs.includes('deaf_hoh') ?? false;
  const state = useTranscript(path, enabled);
  const request = useRequestTranscript(path);
  const asked = useRef(false);
  const status = state.data?.status;

  useEffect(() => {
    if (automatic && status === 'none' && !asked.current) {
      asked.current = true;
      request.mutate();
    }
  }, [automatic, status, request]);

  if (!enabled || !status) return null;
  const tone = onPrimary ? 'onPrimary' : 'muted';
  const link = (label: string) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => request.mutate()}
      disabled={request.isPending}
      style={styles.link}
    >
      <AppText variant="label" tone={onPrimary ? 'onPrimary' : 'primary'} style={styles.underline}>
        {label}
      </AppText>
    </Pressable>
  );

  if (status === 'none') return link(t('transcript.show'));
  if (status === 'failed') {
    return (
      <View style={styles.box}>
        <AppText variant="caption" tone={tone}>
          {t('transcript.failed')}
        </AppText>
        {link(t('transcript.retry'))}
      </View>
    );
  }
  if (status === 'unavailable') {
    return (
      <AppText variant="caption" tone={tone}>
        {t('transcript.voiceOnly')}
      </AppText>
    );
  }
  return (
    <View
      style={[styles.box, { borderColor: onPrimary ? colors.onPrimary : colors.border }]}
      accessibilityLiveRegion="polite"
    >
      {status === 'pending' ? (
        <AppText variant="caption" tone={tone}>
          {t('transcript.pending')}
        </AppText>
      ) : (
        <>
          <AppText variant="body" tone={onPrimary ? 'onPrimary' : 'default'} userContent>
            {state.data?.text}
          </AppText>
          <AppText variant="caption" tone={tone}>
            {t('transcript.automatic')}
          </AppText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  box: { gap: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.xs },
});
