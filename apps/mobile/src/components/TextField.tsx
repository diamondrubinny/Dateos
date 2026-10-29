// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useId } from 'react';
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText, startAlign } from './AppText';

export interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | undefined;
  optionalLabel?: string;
}

export function TextField({
  label,
  hint,
  error,
  optionalLabel,
  style,
  multiline,
  ...rest
}: TextFieldProps) {
  const colors = useColors();
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <View style={styles.wrap}>
      <AppText variant="label" nativeID={`${id}-label`}>
        {label}
        {optionalLabel ? (
          <AppText variant="caption" tone="muted">{`  (${optionalLabel})`}</AppText>
        ) : null}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={`${id}-label`}
        {...(hint || error ? { accessibilityHint: [error, hint].filter(Boolean).join('. ') } : {})}
        aria-invalid={Boolean(error)}
        {...(Platform.OS === 'web' && describedBy ? { 'aria-describedby': describedBy } : {})}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        maxFontSizeMultiplier={2}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.background,
            borderColor: error ? colors.danger : colors.control,
            textAlign: startAlign,
          },
          multiline && styles.multiline,
          style,
        ]}
        {...rest}
      />
      {hint ? (
        <AppText variant="caption" tone="muted" nativeID={`${id}-hint`}>
          {hint}
        </AppText>
      ) : null}
      {error ? (
        <AppText
          variant="caption"
          tone="danger"
          nativeID={`${id}-error`}
          accessibilityLiveRegion="polite"
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top', paddingTop: spacing.sm + 2 },
});
