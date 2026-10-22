// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { useSetConsents, useSetLocation } from '../../lib/queries';
import { ONBOARDING_TOTAL } from '../../lib/routes';
import { radius, spacing, useColors } from '../../lib/theme';

export default function LocationStep() {
  const { t } = useTranslation();
  const colors = useColors();
  const consents = useSetConsents();
  const setLocation = useSetLocation();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return setError(t('location.denied'));
      // Low accuracy is enough: the server keeps only a ~1 km cell anyway.
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      await consents.mutateAsync([{ kind: 'location', granted: true, version: '1' }]);
      await setLocation.mutateAsync({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });
      router.replace('/');
    } catch {
      setError(t('location.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  const points = ['point1', 'point2', 'point3'] as const;
  return (
    <Screen
      title={t('location.title')}
      subtitle={t('location.subtitle')}
      step={{ current: 5, total: ONBOARDING_TOTAL }}
      footer={<Button label={t('location.allow')} loading={busy} onPress={() => void share()} />}
    >
      {error ? <Banner tone="error" message={error} /> : null}
      <View style={[styles.card, { backgroundColor: colors.surface }]} role="list">
        {points.map((key) => (
          <View key={key} style={styles.row} role="listitem">
            <AppText
              variant="heading"
              tone="primary"
              importantForAccessibility="no"
              accessibilityElementsHidden
            >
              ✓
            </AppText>
            <AppText variant="body" style={styles.text}>
              {t(`location.${key}`)}
            </AppText>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  text: { flex: 1 },
});
