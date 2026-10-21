import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Screen } from '../components/Screen';
import { storageInventory, type StorageItem } from '../lib/storage-inventory';
import { radius, spacing, useColors } from '../lib/theme';

function Item({ item }: { item: StorageItem }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={[styles.item, { backgroundColor: colors.surface }]}>
      <AppText variant="label" style={styles.name}>
        {item.name}
      </AppText>
      <AppText variant="body">{t(`cookies.purpose.${item.purpose}`)}</AppText>
      <AppText variant="caption" tone="muted">
        {t(`cookies.kind.${item.kind}`)} · {t(`cookies.duration.${item.duration}`)} ·{' '}
        {t('cookies.necessary')}
      </AppText>
    </View>
  );
}

export default function CookiesPage() {
  const { t } = useTranslation();
  const section = (platform: StorageItem['platform']) => (
    <View style={styles.section}>
      {storageInventory
        .filter((i) => i.platform === platform)
        .map((i) => (
          <Item key={`${i.kind}:${i.name}`} item={i} />
        ))}
    </View>
  );
  return (
    <Screen back title={t('cookies.title')}>
      <Banner tone="info" message={t('cookies.summary')} />
      <AppText variant="body">{t('cookies.intro')}</AppText>
      <AppText variant="heading">{t('cookies.web')}</AppText>
      {section('web')}
      <AppText variant="heading">{t('cookies.native')}</AppText>
      {section('native')}
      <AppText variant="heading">{t('cookies.thirdPartyTitle')}</AppText>
      <AppText variant="body">{t('cookies.thirdParty')}</AppText>
      <AppText variant="body">{t('cookies.control')}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  item: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  name: { writingDirection: 'ltr', alignSelf: 'flex-start', fontFamily: 'monospace' },
});
