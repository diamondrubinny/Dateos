// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { About } from '@nexaheart/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/**
 * Interests, lifestyle and the opening question on a profile (phase 19). Only what the member
 * filled in is shown; interests you share are marked (with words, not only colour).
 */
export function AboutSection({
  about,
  name,
  mine,
}: {
  about: About;
  name: string;
  /** The viewer's own interests, to point out the shared ones. */
  mine?: readonly string[];
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const facts = [
    about.children ? t(`about.childrenOptions.${about.children}`) : null,
    about.smoking ? t(`about.smokingShort.${about.smoking}`) : null,
    about.drinking ? t(`about.drinkingShort.${about.drinking}`) : null,
    about.heightCm ? t('about.heightValue', { cm: about.heightCm }) : null,
    about.religion ? t(`about.religionOptions.${about.religion}`) : null,
  ].filter((f): f is string => f !== null);

  if (facts.length === 0 && about.interests.length === 0 && !about.openingQuestion) return null;
  return (
    <View style={styles.wrap} testID="about-section">
      {facts.length > 0 ? (
        <View style={styles.chips} role="list" accessibilityLabel={t('about.factsLabel', { name })}>
          {facts.map((fact) => (
            <View key={fact} role="listitem" style={[styles.chip, { borderColor: colors.border }]}>
              <AppText variant="caption">{fact}</AppText>
            </View>
          ))}
        </View>
      ) : null}
      {about.interests.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="label">{t('about.interestsOf', { name })}</AppText>
          <View style={styles.chips} role="list">
            {about.interests.map((key) => {
              const shared = mine?.includes(key) ?? false;
              return (
                <View
                  key={key}
                  role="listitem"
                  style={[
                    styles.chip,
                    shared
                      ? { backgroundColor: colors.primarySoft, borderColor: colors.primary }
                      : { borderColor: colors.border },
                  ]}
                >
                  <AppText variant="caption" tone={shared ? 'primary' : 'default'}>
                    {shared ? `✓ ${t(`interest.${key}`)}` : t(`interest.${key}`)}
                  </AppText>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
      {about.openingQuestion ? (
        <View style={[styles.question, { backgroundColor: colors.primarySoft }]}>
          <AppText variant="caption" tone="primary">
            {t('about.askedYou', { name })}
          </AppText>
          <AppText variant="heading" userContent>
            {about.openingQuestion}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  section: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  question: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
});
