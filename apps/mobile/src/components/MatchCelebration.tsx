// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import { useDisplay } from '../lib/display';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/** Full-screen overlay, so the match is announced and visible wherever the user has scrolled. */
export function MatchCelebration({ name, onClose }: { name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { motionOff } = useDisplay();
  return (
    <Modal transparent animationType={motionOff ? 'none' : 'fade'} onRequestClose={onClose} visible>
      <View style={styles.backdrop}>
        <View
          style={[styles.card, { backgroundColor: colors.primary }]}
          role="dialog"
          aria-modal
          aria-label={t('matches.newMatchTitle')}
          accessibilityLiveRegion="assertive"
        >
          <AppText variant="display" tone="onPrimary" center>
            💜 {t('matches.newMatchTitle')}
          </AppText>
          <AppText variant="heading" tone="onPrimary" center>
            {t('matches.newMatchBody', { name })}
          </AppText>
          <AppText variant="body" tone="onPrimary" center>
            {t('matches.sayHi')}
          </AppText>
          <Button
            variant="secondary"
            label={t('matches.viewMatches')}
            onPress={() => {
              onClose();
              router.push('/matches');
            }}
          />
          <Button variant="secondary" label={t('matches.keepExploring')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(18, 15, 28, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: spacing.xl,
    borderRadius: radius.lg,
    gap: spacing.md,
  },
});
