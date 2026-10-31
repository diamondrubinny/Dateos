// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { useChatSettings, useSetSetting } from '../lib/chat-queries';
import { useMyIntroductions } from '../lib/introduction-queries';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Checkbox } from './Choice';

/** Phase 68a, the Matches tab: introductions waiting for my answer, or my matchmaker console. */
export function IntroductionsEntry() {
  const { t } = useTranslation();
  const colors = useColors();
  const data = useMyIntroductions().data;
  if (!data) return null;
  const waiting = data.received.filter((r) => r.state === 'open' && r.myAnswer === null).length;
  if (waiting === 0 && !data.matchmakerSince && data.received.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="link"
      testID="introductions-entry"
      onPress={() => router.push('/introductions')}
      style={[styles.entry, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <AppText variant="label">💌 {t('intro.entry')}</AppText>
      {waiting > 0 ? (
        <AppText variant="caption" tone="primary">
          {t('intro.entryWaiting', { count: waiting })}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** Phase 68a, Settings: may community matchmakers find me (off by default). */
export function OpenToMatchmakers({ onError }: { onError: () => void }) {
  const { t } = useTranslation();
  const settings = useChatSettings();
  const set = useSetSetting();
  return (
    <>
      <AppText variant="heading">{t('intro.settingsTitle')}</AppText>
      <Checkbox
        label={t('intro.openLabel')}
        hint={t('intro.openHint')}
        checked={settings.data?.openToMatchmakers ?? false}
        onChange={(v) => set.mutate({ openToMatchmakers: v }, { onError })}
      />
      {/* Phase 68c. */}
      <Checkbox
        label={t('suggest.settingLabel')}
        hint={t('suggest.settingHint')}
        checked={settings.data?.friendSuggestions ?? true}
        onChange={(v) => set.mutate({ friendSuggestions: v }, { onError })}
      />
      <Button
        variant="secondary"
        label={t('intro.entry')}
        onPress={() => router.push('/introductions')}
      />
      <Button
        variant="secondary"
        label={t('suggest.title')}
        onPress={() => router.push('/suggest-friends')}
      />
    </>
  );
}

const styles = StyleSheet.create({
  entry: {
    minHeight: MIN_TOUCH,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
});
