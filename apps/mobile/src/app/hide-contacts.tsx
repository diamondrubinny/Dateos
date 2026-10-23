// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_CONTACT_HASHES } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { deviceContactsAvailable, readContactEmails } from '../lib/device-contacts';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import {
  extractEmails,
  useClearContactHides,
  useContactHides,
  useHideContacts,
} from '../lib/trust-queries';

/**
 * Hide me from my contacts (phase 21): addresses are hashed on the device; the server keeps only
 * which members matched, and hides both ways in Discover, silently.
 */
function HideContacts() {
  const { t } = useTranslation();
  const colors = useColors();
  const current = useContactHides();
  const hide = useHideContacts();
  const clear = useClearContactHides();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();

  if (current.isPending) return <Loading />;
  const hidden = current.data?.hidden ?? 0;

  const send = (emails: string[]) => {
    if (emails.length === 0) return setMessage({ tone: 'error', text: t('contacts.none') });
    if (emails.length > MAX_CONTACT_HASHES) {
      setMessage({ tone: 'info', text: t('contacts.tooMany', { max: MAX_CONTACT_HASHES }) });
    }
    hide.mutate(emails, {
      onSuccess: (data) => {
        setText('');
        setMessage({ tone: 'info', text: t('contacts.done', { count: data.hidden }) });
      },
      onError: () => setMessage({ tone: 'error', text: t('common.genericError') }),
    });
  };

  const fromDevice = async () => {
    setMessage(undefined);
    const emails = await readContactEmails().catch(() => 'denied' as const);
    if (emails === 'denied') return setMessage({ tone: 'error', text: t('contacts.denied') });
    send(emails);
  };

  return (
    <Screen back title={t('contacts.title')}>
      <AppText variant="body">{t('contacts.intro')}</AppText>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <AppText variant="heading">{t('contacts.howTitle')}</AppText>
        <AppText variant="body" tone="muted">
          {t('contacts.how')}
        </AppText>
      </View>

      <AppText variant="label" accessibilityLiveRegion="polite" testID="contacts-count">
        {t('contacts.count', { count: hidden })}
      </AppText>
      {message ? <Banner tone={message.tone} message={message.text} /> : null}

      {deviceContactsAvailable ? (
        <Button
          label={t('contacts.fromDevice')}
          loading={hide.isPending}
          onPress={() => void fromDevice()}
        />
      ) : (
        <>
          <AppText variant="label" nativeID="contacts-paste-label">
            {t('contacts.pasteLabel')}
          </AppText>
          <AppText variant="caption" tone="muted" nativeID="contacts-paste-hint">
            {t('contacts.pasteHint')}
          </AppText>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('contacts.pasteLabel')}
            aria-labelledby="contacts-paste-label"
            aria-describedby="contacts-paste-hint"
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.background,
              },
            ]}
          />
          <Button
            label={t('contacts.hide')}
            loading={hide.isPending}
            onPress={() => send(extractEmails(text))}
          />
        </>
      )}

      {hidden > 0 ? (
        <Button
          variant="ghost"
          label={t('contacts.clear')}
          loading={clear.isPending}
          onPress={() =>
            clear.mutate(undefined, {
              onSuccess: () => setMessage({ tone: 'info', text: t('contacts.cleared') }),
              onError: () => setMessage({ tone: 'error', text: t('common.genericError') }),
            })
          }
        />
      ) : null}
      <AppText variant="caption" tone="muted">
        {t('contacts.later')}
      </AppText>
    </Screen>
  );
}

export default function HideContactsScreen() {
  return (
    <RequireSession>
      <HideContacts />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  input: {
    minHeight: MIN_TOUCH * 3,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    textAlignVertical: 'top',
    writingDirection: 'ltr',
  },
});
