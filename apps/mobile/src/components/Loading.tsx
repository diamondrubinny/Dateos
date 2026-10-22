import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useColors } from '../lib/theme';

export function Loading() {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.background }]}
      accessibilityLabel={t('common.loading')}
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
