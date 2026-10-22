// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { RemoteImage } from '../components/RemoteImage';
import { Screen } from '../components/Screen';
import { DEFAULT_TAGLINE } from '@nexaheart/shared';
import { useInstance } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { PoweredBy } from '../components/PoweredBy';

export default function Welcome() {
  const { t } = useTranslation();
  const colors = useColors();
  const instance = useInstance();
  const features = ['safety', 'free', 'ai'] as const;
  const icons = { safety: '🛡️', free: '💜', ai: '✨' };

  return (
    <Screen footer={<Button label={t('welcome.start')} onPress={() => router.push('/sign-in')} />}>
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        {instance.data?.logoUrl ? (
          <RemoteImage path={instance.data.logoUrl} label="" style={styles.logo} />
        ) : null}
        <AppText variant="display" tone="onPrimary" center accessibilityRole="header" userContent>
          {instance.data?.name ?? 'NexaHeart'}
        </AppText>
        {instance.data && instance.data.tagline !== DEFAULT_TAGLINE ? (
          <AppText variant="body" tone="onPrimary" center userContent>
            {instance.data.tagline}
          </AppText>
        ) : null}
        <AppText variant="heading" tone="onPrimary" center>
          {t('welcome.title')}
        </AppText>
      </View>
      <AppText variant="body" tone="muted">
        {t('welcome.subtitle')}
      </AppText>
      <View style={styles.list} role="list">
        {features.map((key) => (
          <View
            key={key}
            style={[styles.item, { backgroundColor: colors.surface }]}
            role="listitem"
          >
            <AppText variant="heading" importantForAccessibility="no" accessibilityElementsHidden>
              {icons[key]}
            </AppText>
            <AppText variant="body" style={styles.itemText}>
              {t(`welcome.features.${key}`)}
            </AppText>
          </View>
        ))}
      </View>
      <LanguageSwitch />
      <View style={styles.links}>
        <AppText variant="caption" tone="muted">
          {t('welcome.footer')}
        </AppText>
        <View style={styles.linkRow}>
          <Link href="/terms" style={[styles.link, { color: colors.primary }]}>
            {t('settings.terms')}
          </Link>
          <Link href="/privacy" style={[styles.link, { color: colors.primary }]}>
            {t('settings.privacyPolicy')}
          </Link>
          <Link href="/accessibility" style={[styles.link, { color: colors.primary }]}>
            {t('settings.accessibility')}
          </Link>
          <Link href="/cookies" style={[styles.link, { color: colors.primary }]}>
            {t('settings.cookies')}
          </Link>
        </View>
      </View>
      <PoweredBy />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
  },
  list: { gap: spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  itemText: { flex: 1 },
  links: { gap: spacing.sm },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  link: {
    fontSize: 15,
    fontWeight: '600',
    textDecorationLine: 'underline',
    paddingVertical: spacing.sm,
  },
});
