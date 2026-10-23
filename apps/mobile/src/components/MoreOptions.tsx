// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useDisplay } from '../lib/display';
import { spacing } from '../lib/theme';
import { Button } from './Button';

/**
 * Easy mode (phase 25): less-used options start folded behind one "More options" button.
 * Without easy mode the children show as usual.
 */
export function MoreOptions({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { easy } = useDisplay();
  const [open, setOpen] = useState(false);
  if (!easy) return <>{children}</>;
  return (
    <>
      <Button
        variant="ghost"
        label={open ? t('display.fewerOptions') : t('display.moreOptions')}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
      />
      {open ? <View style={styles.more}>{children}</View> : null}
    </>
  );
}

const styles = StyleSheet.create({ more: { gap: spacing.md } });
