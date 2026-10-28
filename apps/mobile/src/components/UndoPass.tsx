// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { PublicProfile } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useUndoPass } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * "You passed on Dana · Undo" (phase 29b), after a pass in a deck. The last pass only, for ten
 * minutes; the server decides. On success the deck shows the profile again.
 */
export function UndoPass({
  name,
  onRestored,
  onGone,
}: {
  name: string;
  onRestored: (profile: PublicProfile) => void;
  /** Nothing to undo any more (too late, or the profile can't be shown). */
  onGone: () => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const undo = useUndoPass();
  const [error, setError] = useState<string>();
  return (
    <View
      style={[styles.bar, { backgroundColor: colors.surface }]}
      testID="undo-pass"
      accessibilityLiveRegion="polite"
    >
      <AppText variant="body" style={styles.grow}>
        {error ?? t('undo.passed', { name })}
      </AppText>
      {error ? null : (
        <Button
          variant="secondary"
          label={t('undo.button')}
          hint={t('undo.hint', { name })}
          loading={undo.isPending}
          onPress={() =>
            undo.mutate(undefined, {
              onSuccess: (result) => onRestored(result.profile),
              onError: (e) => {
                if (e instanceof ApiRequestError && e.status === 404) {
                  setError(t('undo.tooLate'));
                  setTimeout(onGone, 4000);
                } else setError(t('common.genericError'));
              },
            })
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  grow: { flex: 1, minWidth: 160 },
});
