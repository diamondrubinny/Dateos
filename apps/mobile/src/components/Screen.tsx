// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale } from '../lib/locale';
import { MIN_TOUCH, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  step?: { current: number; total: number };
  back?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/** Page shell: safe areas, keyboard handling, readable max width on the web, optional progress. */
export function Screen({ title, subtitle, step, back, footer, children }: ScreenProps) {
  const colors = useColors();
  const { direction } = useLocale();
  const { t } = useTranslation();
  // `dir` is a react-native-web prop (not in RN types); native direction comes from I18nManager.
  const dirProps = (Platform.OS === 'web' ? { dir: direction } : {}) as object;
  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.column} {...dirProps}>
            {back || step ? (
              <View style={styles.topRow}>
                {back && router.canGoBack() ? (
                  <Pressable
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.back')}
                    style={styles.backButton}
                    hitSlop={8}
                  >
                    <AppText variant="heading" tone="primary">
                      {direction === 'rtl' ? '→' : '←'}
                    </AppText>
                  </Pressable>
                ) : (
                  <View />
                )}
                {step ? (
                  <View style={styles.stepWrap}>
                    <AppText variant="caption" tone="muted">
                      {t('common.stepOf', { step: step.current, total: step.total })}
                    </AppText>
                    <View
                      style={[styles.track, { backgroundColor: colors.primarySoft }]}
                      role="progressbar"
                      aria-label={t('common.stepOf', { step: step.current, total: step.total })}
                      aria-valuemin={0}
                      aria-valuemax={step.total}
                      aria-valuenow={step.current}
                    >
                      <View
                        style={[
                          styles.fill,
                          {
                            backgroundColor: colors.primary,
                            width: `${(step.current / step.total) * 100}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
            {title ? <AppText variant="title">{title}</AppText> : null}
            {subtitle ? (
              <AppText variant="body" tone="muted">
                {subtitle}
              </AppText>
            ) : null}
            <View style={styles.content}>{children}</View>
          </View>
        </ScrollView>
        {footer ? (
          <View
            style={[
              styles.footer,
              { borderTopColor: colors.border, backgroundColor: colors.background },
            ]}
          >
            <View style={styles.column} {...dirProps}>
              {footer}
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  column: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: spacing.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  backButton: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center' },
  stepWrap: { flex: 1, maxWidth: 220, gap: spacing.xs },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  content: { gap: spacing.lg, marginTop: spacing.md },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});
