// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '../lib/config';
import { useHealthPoll, useServerUnavailable } from '../lib/server-status';
import { spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

/**
 * Phase 55: while the server doesn't answer (an update, a restart), one polite line at the top
 * instead of a puzzle of errors; when it answers again, the open screens reload by themselves.
 */
export function ServerStatusBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  const queryClient = useQueryClient();
  const down = useServerUnavailable();
  useHealthPoll(down, API_URL, () => void queryClient.refetchQueries({ type: 'active' }));
  // Always mounted, so screen readers hear the change once (a live region added with its text
  // isn't always announced).
  return (
    <View accessibilityLiveRegion="polite" aria-live="polite">
      {down ? (
        <SafeAreaView
          edges={['top']}
          style={[styles.bar, { backgroundColor: colors.primarySoft }]}
          testID="server-status"
        >
          <AppText variant="label" tone="primary" center>
            {t('server.banner')}
          </AppText>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
