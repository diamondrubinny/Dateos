// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { MessageView } from '@nexaheart/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

type Quoted = NonNullable<MessageView['replyTo']>;

/** The words for a quoted message (phase 30): its text, or what kind of message it was. */
export function useQuoteText() {
  const { t } = useTranslation();
  return (q: Pick<Quoted, 'kind' | 'preview' | 'state'>): string =>
    q.state === 'unsent'
      ? t('chatControl.unsent')
      : q.state === 'hidden'
        ? t('chatControl.hiddenQuote')
        : q.kind === 'text'
          ? (q.preview ?? '')
          : t(`chatControl.kinds.${q.kind}`);
}

/**
 * The quoted message shown above a reply (phase 30), with who wrote it, so it reads well aloud:
 * "Replying to you: Do you like hiking?".
 */
export function ReplyQuote({
  quote,
  otherName,
  onPrimary,
}: {
  quote: Quoted;
  otherName: string;
  onPrimary?: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const text = useQuoteText()(quote);
  const who = quote.mine ? t('chatControl.you') : otherName;
  return (
    <View
      style={[styles.quote, { borderStartColor: onPrimary ? colors.onPrimary : colors.primary }]}
      accessible
      accessibilityLabel={
        quote.mine
          ? t('chatControl.replyingToYou', { text })
          : t('chatControl.replyingTo', { name: otherName, text })
      }
      testID="reply-quote"
    >
      <AppText variant="caption" tone={onPrimary ? 'onPrimary' : 'primary'}>
        {who}
      </AppText>
      <AppText variant="caption" tone={onPrimary ? 'onPrimary' : 'muted'} numberOfLines={2}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  quote: {
    borderStartWidth: 3,
    paddingStart: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: radius.sm,
  },
});
