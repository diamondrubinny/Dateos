// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  reactionEmojis,
  reactionKeys,
  type MessageView,
  type ReactionEmoji,
} from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/** A message that may have reactions: not hidden, and its media (if any) already checked. */
export function canReact(message: MessageView): boolean {
  if (message.harm.length > 0) return false;
  if (message.kind === 'image') return message.image?.status === 'clean';
  if (message.kind === 'voice') return message.voice?.status === 'clean';
  return message.kind === 'text';
}

/**
 * Reactions under a message (phase 29b): what each of us chose, and a small button that opens
 * the six choices. Everything is a real button with a spoken name, so it works with a keyboard
 * and a screen reader, not only with a long press.
 */
export function Reactions({
  message,
  otherName,
  onReact,
  busy,
}: {
  message: MessageView;
  otherName: string;
  onReact: (emoji: ReactionEmoji | null) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const { mine, theirs } = message.reactions;
  const word = (emoji: ReactionEmoji) => t(`reactions.names.${reactionKeys[emoji]}`);

  return (
    <View style={[styles.wrap, message.mine ? styles.end : styles.start]} testID="reactions">
      {theirs ? (
        <View
          style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('reactions.theirs', { name: otherName, emoji: word(theirs) })}
        >
          <AppText variant="body">{theirs}</AppText>
        </View>
      ) : null}
      {mine ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('reactions.mine', { emoji: word(mine) })}
          accessibilityHint={t('reactions.removeHint')}
          disabled={busy}
          onPress={() => onReact(null)}
          style={[
            styles.chip,
            { backgroundColor: colors.primarySoft, borderColor: colors.primary },
          ]}
        >
          <AppText variant="body">{mine}</AppText>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('reactions.react')}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        hitSlop={8}
        style={[styles.add, { borderColor: colors.border }]}
        testID="react-button"
      >
        <AppText variant="caption" tone="muted">
          {open ? '✕' : '☺︎+'}
        </AppText>
      </Pressable>
      {open ? (
        <View
          style={[styles.picker, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="menu"
        >
          {reactionEmojis.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="menuitem"
              accessibilityLabel={word(emoji)}
              accessibilityState={{ selected: mine === emoji }}
              disabled={busy}
              onPress={() => {
                setOpen(false);
                onReact(mine === emoji ? null : emoji);
              }}
              style={[
                styles.choice,
                mine === emoji ? { backgroundColor: colors.primarySoft } : null,
              ]}
            >
              <AppText variant="heading">{emoji}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  start: { justifyContent: 'flex-start' },
  end: { justifyContent: 'flex-end' },
  chip: {
    minWidth: 44,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  add: {
    minWidth: 44,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    padding: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  choice: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
});
