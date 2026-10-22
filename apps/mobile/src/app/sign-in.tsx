// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { requestMagicLink } from '../lib/magic-link';
import { PoweredBy } from '../components/PoweredBy';

const emailSchema = z.email();

export default function SignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const value = email.trim();
    if (!emailSchema.safeParse(value).success) return setFieldError(t('signIn.invalidEmail'));
    setFieldError(undefined);
    setFailed(false);
    setSending(true);
    const ok = await requestMagicLink(value).catch(() => false);
    setSending(false);
    if (!ok) return setFailed(true);
    router.push({ pathname: '/check-email', params: { email: value } });
  };

  return (
    <Screen
      back
      title={t('signIn.title')}
      subtitle={t('signIn.subtitle')}
      footer={<Button label={t('signIn.submit')} loading={sending} onPress={() => void submit()} />}
    >
      {failed ? <Banner tone="error" message={t('common.genericError')} /> : null}
      <TextField
        label={t('signIn.email')}
        hint={t('signIn.emailHint')}
        error={fieldError}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        inputMode="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
        style={{ writingDirection: 'ltr' }}
      />
      <PoweredBy />
    </Screen>
  );
}
