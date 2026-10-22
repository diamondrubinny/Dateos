import { StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

export function Banner({ tone, message }: { tone: 'error' | 'success' | 'info'; message: string }) {
  const colors = useColors();
  const palette = {
    error: { bg: colors.dangerSoft, fg: 'danger' as const },
    success: { bg: colors.successSoft, fg: 'success' as const },
    info: { bg: colors.primarySoft, fg: 'primary' as const },
  }[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={[styles.box, { backgroundColor: palette.bg }]}
    >
      <AppText variant="label" tone={palette.fg}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({ box: { padding: spacing.md, borderRadius: radius.md } });
