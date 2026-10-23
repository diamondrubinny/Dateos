// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Platform, StyleSheet, Text, type TextProps } from 'react-native';
import { useDisplay } from '../lib/display';
import { useColors } from '../lib/theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';

const sizes: Record<
  Variant,
  { fontSize: number; lineHeight: number; fontWeight: '400' | '600' | '700' }
> = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  label: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
};

/**
 * React Native's `textAlign: 'left'` means "start" on native RTL; on the web `start` is used.
 * Without it, native text would stay left-aligned in Hebrew.
 */
export const startAlign = (Platform.OS === 'web' ? 'start' : 'left') as 'left';

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: 'default' | 'muted' | 'primary' | 'danger' | 'success' | 'onPrimary';
  center?: boolean;
  /** User-written text (bio, answers): direction follows its own first strong character. */
  userContent?: boolean;
}

export function AppText({
  variant = 'body',
  tone = 'default',
  center,
  userContent,
  style,
  ...rest
}: AppTextProps) {
  const colors = useColors();
  const { scale } = useDisplay();
  const size = sizes[variant];
  const color = {
    default: colors.text,
    muted: colors.muted,
    primary: colors.primary,
    danger: colors.danger,
    success: colors.success,
    onPrimary: colors.onPrimary,
  }[tone];
  const isHeading = variant === 'display' || variant === 'title' || variant === 'heading';
  // `dir` is a react-native-web prop; interface text inherits the app direction instead.
  const dirProps = (userContent && Platform.OS === 'web' ? { dir: 'auto' } : {}) as object;
  return (
    <Text
      {...dirProps}
      // Headings are exposed as such so screen-reader users can jump between sections.
      {...(isHeading ? { accessibilityRole: 'header' as const } : {})}
      // The system's text size still applies on top of ours, capped so layouts hold (about ×2).
      maxFontSizeMultiplier={Math.max(1.2, 2 / scale)}
      style={[
        scale === 1
          ? size
          : {
              ...size,
              fontSize: Math.round(size.fontSize * scale),
              lineHeight: Math.round(size.lineHeight * scale),
            },
        // User content on the web keeps CSS `text-align: start`, which follows its own `dir="auto"`
        // (react-native-web would turn `start` into the app's side, e.g. Latin text aligned right).
        {
          color,
          ...(center
            ? { textAlign: 'center' as const }
            : userContent && Platform.OS === 'web'
              ? {}
              : { textAlign: startAlign }),
        },
        userContent && Platform.OS !== 'web' ? styles.auto : null,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({ auto: { writingDirection: 'auto' } });
