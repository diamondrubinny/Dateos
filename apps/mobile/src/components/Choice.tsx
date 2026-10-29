// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Pressable, StyleSheet, View } from 'react-native';
import { useKeyboardMode } from '../lib/focus-visible';
import { MIN_TOUCH, radius, spacing, focusRing, useColors } from '../lib/theme';
import { AppText } from './AppText';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface ChoiceGroupProps<T extends string> {
  label: string;
  options: Option<T>[];
  /** Single-select when `multiple` is false. */
  multiple?: boolean;
  selected: T[];
  onChange: (next: T[]) => void;
  error?: string | undefined;
  /** One option per line, full width (for sentence-length options). */
  stacked?: boolean;
}

/** Chips exposed as radio buttons or checkboxes, so state is announced by screen readers. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  multiple,
  selected,
  onChange,
  error,
  stacked,
}: ChoiceGroupProps<T>) {
  const colors = useColors();
  const keyboard = useKeyboardMode();
  return (
    <View
      style={styles.wrap}
      // A named group, so screen readers announce what the checkboxes or radios are about.
      role={multiple ? 'group' : 'radiogroup'}
      accessibilityLabel={label}
    >
      <AppText variant="label">{label}</AppText>
      <View style={stacked ? styles.stack : styles.chips}>
        {options.map((option) => {
          const isOn = selected.includes(option.value);
          const toggle = () => {
            if (!multiple) return onChange([option.value]);
            onChange(
              isOn ? selected.filter((v) => v !== option.value) : [...selected, option.value],
            );
          };
          return (
            <Pressable
              key={option.value}
              onPress={toggle}
              accessibilityRole={multiple ? 'checkbox' : 'radio'}
              aria-checked={isOn}
              accessibilityLabel={option.label}
              style={(state) => [
                styles.chip,
                stacked && styles.stackedChip,
                {
                  backgroundColor: isOn ? colors.primary : colors.background,
                  borderColor: isOn ? colors.primary : colors.control,
                },
                keyboard && (state as { focused?: boolean }).focused && focusRing(colors),
              ]}
            >
              <AppText
                variant="label"
                tone={isOn ? 'onPrimary' : 'default'}
                style={styles.chipText}
              >
                {isOn ? `✓ ${option.label}` : option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

interface CheckboxProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  badge?: string;
}

export function Checkbox({ label, hint, checked, onChange, badge }: CheckboxProps) {
  const colors = useColors();
  const keyboard = useKeyboardMode();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      {...(hint ? { accessibilityHint: hint } : {})}
      style={(state) => [
        styles.checkRow,
        { borderColor: colors.border, backgroundColor: colors.surface },
        keyboard && (state as { focused?: boolean }).focused && focusRing(colors),
      ]}
    >
      <View
        style={[
          styles.box,
          {
            borderColor: checked ? colors.primary : colors.muted,
            backgroundColor: checked ? colors.primary : 'transparent',
          },
        ]}
      >
        {checked ? (
          <AppText tone="onPrimary" variant="label">
            ✓
          </AppText>
        ) : null}
      </View>
      <View style={styles.checkText}>
        <AppText variant="label">
          {label}
          {badge ? <AppText variant="caption" tone="primary">{`  ${badge}`}</AppText> : null}
        </AppText>
        {hint ? (
          <AppText variant="caption" tone="muted">
            {hint}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH - 4,
    // Long labels (any language, large text) wrap inside the chip instead of leaving the screen.
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  stackedChip: { borderRadius: radius.md, paddingVertical: spacing.md },
  chipText: { flexShrink: 1 },
  checkRow: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'flex-start',
    minHeight: MIN_TOUCH,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkText: { flex: 1, gap: 2 },
});
