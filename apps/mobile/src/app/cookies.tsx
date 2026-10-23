// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Screen } from '../components/Screen';
import { storageInventory, type StorageItem } from '../lib/storage-inventory';
import { radius, spacing, useColors } from '../lib/theme';
import { PoweredBy } from '../components/PoweredBy';
import { useInstance } from '../lib/queries';

/** Brand names stay as they are in every language. */
const PROVIDER_NAMES: Record<string, string> = {
  turnstile: 'Cloudflare Turnstile',
  hcaptcha: 'hCaptcha',
  plausible: 'Plausible',
  umami: 'Umami',
  matomo: 'Matomo',
};

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
  // Phase 24: what the community set up decides which outside services are listed.
  const integrations = useInstance().data?.integrations;
  const captcha = integrations?.captcha ?? null;
  const analytics = integrations?.analytics ?? null;
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
      {captcha || analytics ? (
        <>
          {captcha ? (
            <AppText variant="body">
              {t('cookies.captcha', { provider: PROVIDER_NAMES[captcha.provider] })}
            </AppText>
          ) : null}
          {analytics ? (
            <AppText variant="body">
              {t('cookies.analytics', { provider: PROVIDER_NAMES[analytics.provider] })}
            </AppText>
          ) : null}
          <AppText variant="body">{t('cookies.pushOnly')}</AppText>
        </>
      ) : (
        <AppText variant="body">{t('cookies.thirdParty')}</AppText>
      )}
      <AppText variant="body">{t('cookies.control')}</AppText>
      <PoweredBy />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  item: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  name: { writingDirection: 'ltr', alignSelf: 'flex-start', fontFamily: 'monospace' },
});
