// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { MeResponse } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { STRONG_PHOTOS, STRONG_PROMPTS, strengthItems } from '../lib/profile-strength';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/**
 * Profile tab: "Profile strength", a short checklist with links. Words and ✓ / ○ marks, never colour
 * alone; hidden once everything is done.
 */
export function ProfileStrength({ me }: { me: MeResponse }) {
  const { t } = useTranslation();
  const colors = useColors();
  const items = strengthItems(me);
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID="profile-strength"
    >
      <AppText variant="heading">{t('strength.title')}</AppText>
      <AppText variant="body" testID="profile-strength-count">
        {t('strength.count', { done, total: items.length })}
      </AppText>
      <View
        style={[styles.track, { backgroundColor: colors.background }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <View
          style={[
            styles.fill,
            { backgroundColor: colors.primary, width: `${(done / items.length) * 100}%` },
          ]}
        />
      </View>
      <View role="list">
        {items.map((item) =>
          item.done ? (
            <View key={item.key} role="listitem" style={styles.row}>
              <AppText variant="body" tone="muted">
                {`✓ ${t(`strength.items.${item.key}`, { photos: STRONG_PHOTOS, prompts: STRONG_PROMPTS })} · ${t('strength.done')}`}
              </AppText>
            </View>
          ) : (
            <View key={item.key} role="listitem">
              <Pressable
                accessibilityRole="link"
                accessibilityHint={t('strength.addHint')}
                onPress={() => router.push(item.href)}
                style={styles.row}
              >
                <AppText variant="body" tone="primary">
                  {`○ ${t(`strength.items.${item.key}`, { photos: STRONG_PHOTOS, prompts: STRONG_PROMPTS })}`}
                </AppText>
              </Pressable>
            </View>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
  row: { minHeight: MIN_TOUCH, justifyContent: 'center' },
});
