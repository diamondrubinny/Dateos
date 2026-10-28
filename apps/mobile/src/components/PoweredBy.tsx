// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { CREDIT_AUTHOR_URL, CREDIT_URL, creditText, UPSTREAM_SOURCE_URL } from '@nexaheart/shared';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { useInstance } from '../lib/queries';
import { spacing } from '../lib/theme';
import { AppText } from './AppText';

/**
 * "Powered by NexaHeart · Open source". Keeping this credit visible is an additional term of the
 * license (AGPL-3.0 section 7(b), see NOTICE), whatever name and logo the community uses. "Open
 * source" links to this instance's source code (AGPL section 13). Below it, who created NexaHeart
 * (phase 29).
 */
export function PoweredBy() {
  const { i18n } = useTranslation();
  const instance = useInstance().data;
  const text = creditText(i18n.language);
  const sourceUrl = instance?.poweredBy.sourceUrl ?? UPSTREAM_SOURCE_URL;
  return (
    <View style={styles.column}>
      <View style={styles.row} testID="powered-by">
        <AppText
          variant="caption"
          tone="muted"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(CREDIT_URL)}
          style={styles.link}
        >
          {text.poweredBy}
        </AppText>
        <AppText variant="caption" tone="muted" aria-hidden>
          ·
        </AppText>
        <AppText
          variant="caption"
          tone="muted"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(sourceUrl)}
          style={styles.link}
        >
          {text.openSource}
        </AppText>
      </View>
      <AppText
        variant="caption"
        tone="muted"
        accessibilityRole="link"
        onPress={() => void Linking.openURL(CREDIT_AUTHOR_URL)}
        style={styles.author}
        testID="created-by"
      >
        {text.createdBy}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: 'center' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // A comfortable tap target for a small text link.
  link: { textDecorationLine: 'underline', paddingVertical: 12 },
  // The tap target stays comfortable without doubling the gap under the credit.
  author: { textDecorationLine: 'underline', paddingBottom: 12, marginTop: -8 },
});
