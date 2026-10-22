// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { Screen } from '../components/Screen';
import { ApiRequestError } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { useMe } from '../lib/queries';
import { routeFor } from '../lib/routes';

export default function Index() {
  const { t } = useTranslation();
  const session = authClient.useSession();
  const me = useMe(Boolean(session.data));

  if (session.isPending || (session.data && me.isPending)) return <Loading />;
  if (!session.data) return <Redirect href="/welcome" />;
  if (me.error) {
    const suspended = me.error instanceof ApiRequestError && me.error.status === 403;
    return (
      <Screen>
        <Banner
          tone="error"
          message={suspended ? t('onboarding.profile.underage') : t('common.genericError')}
        />
        {suspended ? (
          <Button
            label={t('settings.signOut')}
            variant="ghost"
            onPress={() => void authClient.signOut()}
          />
        ) : (
          <Button label={t('common.retry')} onPress={() => void me.refetch()} />
        )}
      </Screen>
    );
  }
  return <Redirect href={routeFor(me.data!)} />;
}
