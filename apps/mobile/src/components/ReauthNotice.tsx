// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { RECENT_SIGN_IN_MINUTES } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ltr } from '../lib/bidi';
import { requestMagicLink } from '../lib/magic-link';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

/**
 * Sensitive actions (phase 43) need a sign-in from the last few minutes. This offers a fresh link
 * to the account's own address; after signing in with it, the member does the action again.
 */
export function ReauthNotice({ email }: { email: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const send = async () => {
    setState('sending');
    const result = await requestMagicLink(email).catch(() => false);
    // A community that asks for the bot check signs in on the usual screen.
    if (result === 'captcha') return router.push('/sign-in');
    setState(result ? 'sent' : 'error');
  };
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface }]}
      accessibilityRole="alert"
      testID="reauth-notice"
    >
      <AppText variant="heading">{t('reauth.title')}</AppText>
      <AppText variant="body">{t('reauth.body', { minutes: RECENT_SIGN_IN_MINUTES })}</AppText>
      {state === 'sent' ? (
        <Banner tone="info" message={t('reauth.sent', { email: ltr(email) })} />
      ) : (
        <Button
          label={t('reauth.send')}
          loading={state === 'sending'}
          onPress={() => void send()}
        />
      )}
      {state === 'error' ? <Banner tone="error" message={t('common.genericError')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});
