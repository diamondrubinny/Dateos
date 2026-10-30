// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { UNSEND_MINUTES, type MessageView, type ReactionEmoji } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { router } from 'expo-router';
import { AppText } from './AppText';
import { Button } from './Button';
import { CallLine } from './CallLine';
import { DateCard } from './DateCard';
import { Reactions, canReact } from './Reactions';
import { ReplyQuote } from './ReplyQuote';
import { RemoteImage } from './RemoteImage';
import { VoicePlayer } from './VoicePlayer';
import { VoiceTranscript } from './VoiceTranscript';

/** The app's view of the unsend window; the server has the final say. */
const withinUnsend = (message: MessageView) =>
  Date.now() - new Date(message.createdAt).getTime() < UNSEND_MINUTES * 60_000;

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

/**
 * Phase 65: a threat to share images or tell people unless they pay. Never "pay" or "delete": keep
 * the chat as evidence and report it now (Threat is urgent for moderators).
 */
export function ExtortionBanner({
  other,
  matchId,
}: {
  other?: { id: string; name: string } | undefined;
  matchId: string;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View
      style={[styles.banner, { backgroundColor: colors.dangerSoft }]}
      accessibilityRole="alert"
      testID="extortion-banner"
    >
      <AppText variant="label" tone="danger">
        ⚠️ {t('reach.extortionTitle')}
      </AppText>
      <AppText variant="caption">{t('reach.extortionBody')}</AppText>
      {other ? (
        <Button
          variant="danger"
          label={t('reach.extortionReport', { name: other.name })}
          onPress={() =>
            router.push({
              pathname: '/report/[id]',
              // The chat goes with the report as evidence.
              params: { id: other.id, name: other.name, matchId, category: 'threat' },
            })
          }
        />
      ) : null}
    </View>
  );
}

export function MessageBubble({
  message,
  seen,
  other,
  onReact,
  reacting,
  onReply,
  onUnsend,
}: {
  message: MessageView;
  seen: boolean;
  /** The other person, for "something felt wrong?" on a date card. */
  other?: { id: string; name: string } | undefined;
  /** Reactions (phase 29b); without it (partner chats) none are shown. */
  onReact?: (emoji: ReactionEmoji | null) => void;
  reacting?: boolean;
  /** Phase 30: reply to this message, and unsend it (mine, within UNSEND_MINUTES). */
  onReply?: () => void;
  onUnsend?: () => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const [revealed, setRevealed] = useState(false);
  const [imageShown, setImageShown] = useState(false);
  const mine = message.mine;
  if (message.unsent) {
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]} testID="unsent">
        <View style={[styles.bubble, styles.unsent, { borderColor: colors.border }]}>
          <AppText variant="caption" tone="muted">
            {mine ? t('chatControl.youUnsent') : t('chatControl.unsent')}
          </AppText>
        </View>
      </View>
    );
  }
  if (message.kind === 'date') return <DateCard message={message} other={other} />;
  if (message.kind === 'call') return <CallLine message={message} />;
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
    else
      content = (
        <View style={styles.voice}>
          <VoicePlayer path={voice.url} durationMs={voice.durationMs} onPrimary={mine} />
          <VoiceTranscript path={voice.url} onPrimary={mine} />
        </View>
      );
  } else {
    content = (
      <AppText variant="body" tone={tone} userContent selectable>
        {message.body}
      </AppText>
    );
  }

  return (
    <View
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
      testID={`message-${message.id}`}
    >
      {message.scam.includes('extortion') ? (
        <ExtortionBanner other={other} matchId={message.matchId} />
      ) : message.scam.length > 0 ? (
        <ScamBanner />
      ) : null}
      <View style={bubble}>
        {message.replyTo ? (
          <ReplyQuote quote={message.replyTo} otherName={other?.name ?? ''} onPrimary={mine} />
        ) : null}
        {content}
      </View>
      {onReact && canReact(message) && (!message.hidden || revealed) ? (
        <Reactions
          message={message}
          otherName={other?.name ?? ''}
          onReact={onReact}
          {...(onReply ? { onReply } : {})}
          {...(onUnsend && mine && withinUnsend(message) ? { onUnsend } : {})}
          busy={reacting}
        />
      ) : null}
      {mine && seen ? (
        <AppText variant="caption" tone="muted" style={styles.seen}>
          ✓✓ {t('chat.seen')}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  voice: { gap: spacing.xs },
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
  unsent: { borderStyle: 'dashed', backgroundColor: 'transparent' },
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
