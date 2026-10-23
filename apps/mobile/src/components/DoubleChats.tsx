// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useDoubles } from '../lib/friend-queries';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/** Double date group chats (phase 22), above the 1:1 conversations in the inbox. */
export function DoubleChats() {
  const { t } = useTranslation();
  const colors = useColors();
  const doubles = useDoubles();
  const list = doubles.data ?? [];
  if (list.length === 0) return null;
  return (
    <View style={styles.wrap} testID="double-chats">
      <AppText variant="heading">{t('double.inbox')}</AppText>
      {list.map((d) => {
        const names = d.members.map((m) => m.displayName).join(', ');
        const last = d.lastMessage;
        return (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/double/[id]', params: { id: d.id } })}
            style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <AppText variant="heading" userContent>
              👥 {names}
            </AppText>
            <AppText variant="caption" tone="muted" userContent numberOfLines={1}>
              {d.closed
                ? t('double.closedShort')
                : !last
                  ? t('double.new')
                  : last.hidden
                    ? t('chat.hidden')
                    : last.mine
                      ? t('chat.you', { text: last.text })
                      : last.text}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    minHeight: MIN_TOUCH,
  },
});
