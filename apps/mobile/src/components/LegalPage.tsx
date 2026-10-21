import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useInstance } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Screen } from './Screen';

export const LEGAL_UPDATED = '2026-10-20';

export function LegalPage({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const instance = useInstance().data;
  const email = instance?.contactEmail;
  return (
    <Screen back title={title}>
      <Banner tone="info" message={t('common.draftNotice')} />
      <AppText variant="body">{body}</AppText>
      <View style={[styles.operator, { backgroundColor: colors.surface }]}>
        <AppText variant="label">{t('legal.operatorTitle')}</AppText>
        {instance?.operatorName ? (
          <AppText variant="body" userContent>
            {t('legal.operator', { name: instance.operatorName, instance: instance.name })}
          </AppText>
        ) : (
          <AppText variant="body" tone="muted">
            {t('legal.noOperator')}
          </AppText>
        )}
        {email ? (
          <AppText
            variant="body"
            tone="primary"
            accessibilityRole="link"
            accessibilityLabel={t('legal.contactLabel', { email })}
            onPress={() => void Linking.openURL(`mailto:${email}`)}
            style={styles.email}
          >
            {email}
          </AppText>
        ) : null}
      </View>
      <AppText variant="caption" tone="muted">
        {t('legal.updated', { date: LEGAL_UPDATED })}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  operator: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  email: { textDecorationLine: 'underline', writingDirection: 'ltr', alignSelf: 'flex-start' },
});
