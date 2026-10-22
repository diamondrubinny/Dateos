import type { MessageView } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { DateCard } from './DateCard';
import { RemoteImage } from './RemoteImage';
import { VoicePlayer } from './VoicePlayer';

export function ScamBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={[styles.banner, { backgroundColor: colors.dangerSoft }]} accessibilityRole="alert">
      <AppText variant="label" tone="danger">
        ⚠️ {t('chat.scamTitle')}
      </AppText>
      <AppText variant="caption">{t('chat.scamBody')}</AppText>
    </View>
  );
}

export function MessageBubble({ message, seen }: { message: MessageView; seen: boolean }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [revealed, setRevealed] = useState(false);
  const [imageShown, setImageShown] = useState(false);
  const mine = message.mine;
  if (message.kind === 'date') return <DateCard message={message} />;
  const bubble = [
    styles.bubble,
    mine ? styles.mine : styles.theirs,
    { backgroundColor: mine ? colors.primary : colors.surface, borderColor: colors.border },
  ];
  const tone = mine ? 'onPrimary' : 'default';

  let content;
  if (message.hidden && !revealed) {
    content = (
      <View style={styles.hidden}>
        <AppText variant="caption" tone="muted">
          {t('chat.hidden')}
        </AppText>
        <Pressable accessibilityRole="button" onPress={() => setRevealed(true)} hitSlop={8}>
          <AppText variant="label" tone="primary">
            {t('chat.show')}
          </AppText>
        </Pressable>
      </View>
    );
  } else if (message.kind === 'image') {
    const image = message.image;
    if (!image || image.status === 'pending')
      content = (
        <AppText variant="caption" tone={tone}>
          {t('chat.checking')}
        </AppText>
      );
    else if (image.status === 'rejected' || !image.url)
      content = (
        <AppText variant="caption" tone={tone}>
          {t('chat.rejectedImage')}
        </AppText>
      );
    else
      content = (
        // Images are blurred until the receiver chooses to look (protection from unwanted images).
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={imageShown || mine ? t('chat.photo') : t('chat.tapToView')}
          onPress={() => setImageShown(true)}
        >
          <RemoteImage
            path={image.url}
            label={t('chat.photo')}
            style={styles.image}
            blurRadius={imageShown || mine ? 0 : 40}
          />
          {!imageShown && !mine ? (
            <View style={[styles.overlay, { backgroundColor: colors.background }]}>
              <AppText variant="caption">{t('chat.tapToView')}</AppText>
            </View>
          ) : null}
        </Pressable>
      );
  } else if (message.kind === 'voice') {
    const voice = message.voice;
    if (!voice || voice.status === 'pending')
      content = (
        <AppText variant="caption" tone={tone}>
          {t('voice.processing')}
        </AppText>
      );
    else if (voice.status === 'rejected' || !voice.url)
      content = (
        <AppText variant="caption" tone={tone}>
          {t('voice.rejected')}
        </AppText>
      );
    else content = <VoicePlayer path={voice.url} durationMs={voice.durationMs} onPrimary={mine} />;
  } else {
    content = (
      <AppText variant="body" tone={tone} userContent selectable>
        {message.body}
      </AppText>
    );
  }

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {message.scam.length > 0 ? <ScamBanner /> : null}
      <View style={bubble}>{content}</View>
      {mine && seen ? (
        <AppText variant="caption" tone="muted" style={styles.seen}>
          ✓✓ {t('chat.seen')}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, marginVertical: 3 },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  mine: { borderBottomEndRadius: 4 },
  theirs: { borderBottomStartRadius: 4 },
  hidden: { gap: spacing.xs },
  image: { width: 200, height: 250, borderRadius: radius.md },
  overlay: {
    position: 'absolute',
    bottom: spacing.sm,
    start: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  seen: { marginTop: 2 },
  banner: { maxWidth: '92%', padding: spacing.md, borderRadius: radius.md, gap: 2 },
});
