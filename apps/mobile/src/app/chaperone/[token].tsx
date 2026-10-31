// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { ApiRequestError } from '../../lib/api';
import { useChaperoneLink, useJoinAsChaperone } from '../../lib/chaperone-queries';

/** Phase 68d: someone accepts a member's invitation to be their chaperone. */
function JoinAsChaperone() {
  const { t } = useTranslation();
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const info = useChaperoneLink(token);
  const join = useJoinAsChaperone();
  if (info.isPending) return <Loading />;
  if (!info.data) {
    return (
      <Screen back title={t('chaperone.joinTitle')}>
        <Banner tone="info" message={t('chaperone.invalid')} />
      </Screen>
    );
  }
  const name = info.data.memberName;
  return (
    <Screen back title={t('chaperone.joinTitle')}>
      <AppText variant="body">{t('chaperone.joinIntro', { name })}</AppText>
      <AppText variant="body">{t('chaperone.joinRules')}</AppText>
      {join.error ? (
        <Banner
          tone="error"
          message={
            join.error instanceof ApiRequestError && join.error.status === 409
              ? t('chaperone.already', { name })
              : t('common.genericError')
          }
        />
      ) : null}
      <Button
        label={t('chaperone.accept', { name })}
        loading={join.isPending}
        onPress={() => join.mutate(token, { onSuccess: () => router.replace('/chaperoning') })}
      />
    </Screen>
  );
}

export default function JoinAsChaperoneRoute() {
  return (
    <RequireSession>
      <JoinAsChaperone />
    </RequireSession>
  );
}
