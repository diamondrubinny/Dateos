import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { mediaUrl } from '../lib/api';
import { useSessionCookie } from '../lib/use-cookie';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/** Browsers without AAC (some Linux Chromium builds) get the Opus rendition. Native apps play AAC. */
function preferredFormat(): 'aac' | 'opus' {
  if (Platform.OS !== 'web' || typeof Audio === 'undefined') return 'aac';
  return new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"') ? 'aac' : 'opus';
}

export const formatSeconds = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Play/pause button with elapsed and total time. No gestures needed. */
export function VoicePlayer({
  path,
  durationMs,
  onPrimary,
}: {
  path: string;
  durationMs: number | null;
  onPrimary: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const cookie = useSessionCookie();
  const player = useAudioPlayer({
    uri: mediaUrl(preferredFormat() === 'opus' ? `${path}?format=opus` : path),
    // Native apps send the session cookie explicitly; browsers send it themselves.
    ...(Platform.OS !== 'web' && cookie ? { headers: { cookie } } : {}),
  });
  const status = useAudioPlayerStatus(player);
  const total = durationMs ?? Math.round(status.duration * 1000);
  const elapsed = Math.round(status.currentTime * 1000);
  const toggle = () => {
    if (status.playing) return player.pause();
    if (status.didJustFinish || (total > 0 && elapsed >= total - 100)) void player.seekTo(0);
    player.play();
  };
  const tone = onPrimary ? 'onPrimary' : 'default';
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          status.playing ? t('voice.pause') : t('voice.play', { duration: formatSeconds(total) })
        }
        onPress={toggle}
        style={[styles.button, { backgroundColor: onPrimary ? colors.onPrimary : colors.primary }]}
      >
        <AppText variant="heading" style={{ color: onPrimary ? colors.primary : colors.onPrimary }}>
          {status.playing ? '❚❚' : '▶'}
        </AppText>
      </Pressable>
      <AppText
        variant="caption"
        tone={tone}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        🎙 {status.playing || elapsed > 0 ? `${formatSeconds(elapsed)} / ` : ''}
        {formatSeconds(total)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  button: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
