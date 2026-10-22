import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { useKeyboardMode } from '../lib/focus-visible';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
  loading?: boolean;
  /** Short hint read by screen readers after the label. */
  hint?: string;
}

export function Button({
  label,
  variant = 'primary',
  loading,
  disabled,
  hint,
  ...rest
}: ButtonProps) {
  const colors = useColors();
  const keyboard = useKeyboardMode();
  const isDisabled = Boolean(disabled || loading);
  const palette = {
    primary: { bg: colors.primary, fg: 'onPrimary' as const, border: colors.primary },
    secondary: { bg: colors.primarySoft, fg: 'primary' as const, border: colors.primarySoft },
    ghost: { bg: 'transparent', fg: 'primary' as const, border: colors.border },
    danger: { bg: colors.danger, fg: 'onPrimary' as const, border: colors.danger },
    dangerGhost: { bg: 'transparent', fg: 'danger' as const, border: colors.danger },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint ? { accessibilityHint: hint } : {})}
      aria-disabled={isDisabled}
      aria-busy={Boolean(loading)}
      disabled={isDisabled}
      style={(state) => {
        const focused = keyboard && (state as { focused?: boolean }).focused;
        return [
          styles.base,
          { backgroundColor: palette.bg, borderColor: palette.border },
          state.pressed && styles.pressed,
          isDisabled && styles.disabled,
          focused && {
            outlineColor: colors.focus,
            outlineWidth: 3,
            outlineStyle: 'solid' as const,
          },
        ];
      }}
      {...rest}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator
            color={
              variant === 'primary' || variant === 'danger' ? colors.onPrimary : colors.primary
            }
          />
        ) : null}
        <AppText variant="label" tone={palette.fg} center>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
