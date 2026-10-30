// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { API_URL } from '../lib/config';
import { isUnavailableError, useHealthPoll } from '../lib/server-status';
import { spacing } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { Screen } from './Screen';

/**
 * Phase 55: the app was opened while the server didn't answer (an update, a restart). The member
 * may well be signed in, so this is not the welcome page. Checks every 10 seconds and carries on
 * by itself when the server is back.
 */
export function ServerUnreachable({ onRetry }: { onRetry: () => unknown }) {
  const { t } = useTranslation();
  const [trying, setTrying] = useState(false);
  useHealthPoll(true, API_URL, () => void onRetry());
  return (
    <Screen title={t('server.unreachableTitle')}>
      <View style={styles.gap}>
        <Banner tone="info" message={t('server.unreachableBody')} />
        <AppText>{t('server.unreachableAuto')}</AppText>
        <Button
          label={t('common.retry')}
          loading={trying}
          onPress={() => {
            setTrying(true);
            void Promise.resolve(onRetry()).finally(() => setTrying(false));
          }}
        />
      </View>
    </Screen>
  );
}

/**
 * Where the session gates send "no session": the welcome page when the server said so (signed
 * out), the screen above when it didn't answer.
 */
export function NoSession({ error, onRetry }: { error: unknown; onRetry: () => unknown }) {
  if (error && isUnavailableError(error)) return <ServerUnreachable onRetry={onRetry} />;
  return <Redirect href="/welcome" />;
}

const styles = StyleSheet.create({ gap: { gap: spacing.md } });
