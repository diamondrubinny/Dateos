import type { PublicProfile } from '@dateos/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useKeyboardMode } from '../lib/focus-visible';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { RemoteImage } from './RemoteImage';

/** Compact, fully pressable summary used by Picks, Likes and Matches. */
export function PersonRow({
  profile,
  detail,
  quote,
  plainQuote,
  onPress,
}: {
  profile: PublicProfile;
  detail?: string | undefined;
  quote?: string | null;
  /** Show the quote without quotation marks (e.g. a message preview). */
  plainQuote?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const keyboard = useKeyboardMode();
  const cover = profile.photos[0];
  return (
    <Pressable
      onPress={onPress}
      // No custom label: the accessible name comes from the visible text (WCAG 2.5.3, label in name).
      accessibilityRole="button"
      style={(state) => [
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
        keyboard &&
          (state as { focused?: boolean }).focused && {
            outlineColor: colors.focus,
            outlineWidth: 3,
            outlineStyle: 'solid' as const,
          },
      ]}
    >
      {cover ? (
        <RemoteImage path={cover.url} label={profile.displayName} style={styles.thumb} />
      ) : (
        <View style={styles.thumb} />
      )}
      <View style={styles.text}>
        <AppText variant="heading">
          {profile.displayName}, {profile.age}
        </AppText>
        {detail ? (
          <AppText variant="caption" tone="primary">
            {detail}
          </AppText>
        ) : profile.reasons[0] ? (
          <AppText variant="caption" tone="primary">
            ✦ {t(`reason.${profile.reasons[0]}`)}
          </AppText>
        ) : null}
        {quote ? (
          <AppText variant="body" userContent numberOfLines={2}>
            {plainQuote ? quote : `“${quote}”`}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  thumb: { width: 76, height: 96, borderRadius: radius.md },
  text: { flex: 1, gap: 2 },
});
