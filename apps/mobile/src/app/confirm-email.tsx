// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { Screen } from '../components/Screen';
import { ApiRequestError } from '../lib/api';
import { ltr } from '../lib/bidi';
import { authClient } from '../lib/auth-client';
import { useConfirmEmailChange } from '../lib/queries';

type State =
  | { kind: 'working' }
  | { kind: 'done'; email: string }
  | { kind: 'expired' }
  | { kind: 'unusable' }
  | { kind: 'error' };

/**
 * The link from "Confirm your new email" (phase 41). Works only while signed in to the account
 * that asked; otherwise it says so and offers to sign in first.
 */
export default function ConfirmEmailScreen() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const session = authClient.useSession();
  const confirm = useConfirmEmailChange();
  const [state, setState] = useState<State>({ kind: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current || session.isPending || !session.data || !token) return;
    started.current = true;
    confirm.mutate(token, {
      onSuccess: ({ email }) => setState({ kind: 'done', email }),
      onError: (e) =>
        setState(
          e instanceof ApiRequestError && e.status === 404
            ? { kind: 'expired' }
            : e instanceof ApiRequestError && e.status === 409
              ? { kind: 'unusable' }
              : { kind: 'error' },
        ),
    });
  }, [session.isPending, session.data, token, confirm]);

  if (session.isPending) return <Loading />;
  return (
    <Screen title={t('changeEmail.confirmTitle')}>
      {!session.data ? (
        <>
          <AppText variant="body">{t('changeEmail.signInFirst')}</AppText>
          <Button label={t('changeEmail.signIn')} onPress={() => router.replace('/welcome')} />
        </>
      ) : !token ? (
        <Banner tone="error" message={t('changeEmail.expired')} />
      ) : state.kind === 'working' ? (
        <Loading />
      ) : state.kind === 'done' ? (
        <>
          <Banner tone="info" message={t('changeEmail.done', { email: ltr(state.email) })} />
          <AppText variant="body" tone="muted">
            {t('changeEmail.othersSignedOut')}
          </AppText>
          <Button label={t('common.continue')} onPress={() => router.replace('/settings')} />
        </>
      ) : (
        <>
          <Banner
            tone="error"
            message={
              state.kind === 'expired'
                ? t('changeEmail.expired')
                : state.kind === 'unusable'
                  ? t('changeEmail.unusable')
                  : t('common.genericError')
            }
          />
          <Button
            variant="secondary"
            label={t('changeEmail.tryAgain')}
            onPress={() => router.replace('/change-email')}
          />
        </>
      )}
    </Screen>
  );
}
