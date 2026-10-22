import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { useActiveCheckin } from '../lib/checkin-queries';
import { useLocale } from '../lib/locale';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/** A way into the safety check-in; shows the deadline while one is active. */
export function CheckinEntry() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const active = useActiveCheckin().data;
  const until = active
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(active.checkAt),
      )
    : null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push('/checkin')}
      style={[
        styles.card,
        {
          backgroundColor: active ? colors.primarySoft : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <AppText variant="label" tone={active ? 'primary' : 'default'}>
        {active ? `🛡️ ${t('checkin.banner', { time: until })}` : `🛡️ ${t('checkin.entry')}`}
      </AppText>
      {active ? (
        <AppText variant="caption" tone="primary">
          {t('checkin.manage')}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: MIN_TOUCH,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
});
