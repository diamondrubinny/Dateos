// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { EMAIL_CHANGE_MINUTES } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { ltr } from '../lib/bidi';
import { useMe, useRequestEmailChange } from '../lib/queries';

/**
 * Change your email (phase 41): a link goes to the new address; the current one gets a heads-up.
 * The answer is the same whatever the address, so nobody can probe which addresses have accounts.
 */
function ChangeEmail() {
  const { t } = useTranslation();
  const me = useMe();
  const change = useRequestEmailChange();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string>();
  const [error, setError] = useState<string>();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Screen back title={t('changeEmail.title')}>
      <AppText variant="body">
        {t('changeEmail.current', { email: ltr(me.data?.user.email ?? '') })}
      </AppText>
      <AppText variant="body" tone="muted">
        {t('changeEmail.intro', { minutes: EMAIL_CHANGE_MINUTES })}
      </AppText>
      {sent ? <Banner tone="info" message={t('changeEmail.sent', { email: ltr(sent) })} /> : null}
      {error ? <Banner tone="error" message={error} /> : null}
      <TextField
        label={t('changeEmail.label')}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setError(undefined);
        }}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
      />
      <Button
        label={t('changeEmail.send')}
        disabled={!valid}
        loading={change.isPending}
        onPress={() =>
          change.mutate(email.trim(), {
            onSuccess: () => setSent(email.trim()),
            onError: (e) =>
              setError(
                e instanceof ApiRequestError && e.status === 429
                  ? t('changeEmail.tooMany')
                  : t('common.genericError'),
              ),
          })
        }
      />
    </Screen>
  );
}

export default function ChangeEmailScreen() {
  return (
    <RequireSession>
      <ChangeEmail />
    </RequireSession>
  );
}
