// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Checkbox, ChoiceGroup } from '../components/Choice';
import { Screen } from '../components/Screen';
import { textSizes, useDisplay } from '../lib/display';
import { radius, spacing, useColors } from '../lib/theme';

/** Display and ease of use (phase 25): open to everyone, before signing in too. */
export default function Display() {
  const { t } = useTranslation();
  const colors = useColors();
  const display = useDisplay();
  return (
    <Screen back title={t('display.title')} subtitle={t('display.subtitle')}>
      <ChoiceGroup
        label={t('display.textSize')}
        options={textSizes.map((value) => ({ value, label: t(`display.sizes.${value}`) }))}
        selected={[display.textSize]}
        onChange={([size]) => size && display.update({ textSize: size })}
      />
      <View
        style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <AppText variant="heading">{t('display.previewTitle')}</AppText>
        <AppText variant="body">{t('display.previewBody')}</AppText>
      </View>
      <Checkbox
        label={t('display.easyLabel')}
        hint={t('display.easyHint')}
        checked={display.easy}
        onChange={(easy) => display.update({ easy })}
      />
      <Checkbox
        label={t('display.contrastLabel')}
        hint={t('display.contrastHint')}
        checked={display.contrast}
        onChange={(contrast) => display.update({ contrast })}
      />
      <Checkbox
        label={t('display.motionLabel')}
        hint={t('display.motionHint')}
        checked={display.reduceMotion}
        onChange={(reduceMotion) => display.update({ reduceMotion })}
      />
      <AppText variant="caption" tone="muted">
        {t('display.deviceOnly')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm },
});
