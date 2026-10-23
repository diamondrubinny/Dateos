// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../../components/AppText';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { RequireSession } from '../../../components/RequireSession';
import { Screen } from '../../../components/Screen';
import { ApiRequestError } from '../../../lib/api';
import { useJoinPair } from '../../../lib/friend-queries';

/** Accepting a friend's invitation to pair up for double dates (phase 22). */
function JoinPair() {
  const { t } = useTranslation();
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const join = useJoinPair();
  const failure =
    join.error instanceof ApiRequestError && join.error.status === 409
      ? t('pair.joinBusy')
      : join.error
        ? t('pair.joinDead')
        : undefined;
  return (
    <Screen back title={t('pair.joinTitle')}>
      {join.data ? (
        <>
          <Banner
            tone="success"
            message={t('pair.joined', { name: join.data.friend.displayName })}
          />
          <Button label={t('pair.findPairs')} onPress={() => router.replace('/discover')} />
        </>
      ) : (
        <>
          <AppText variant="body">{t('pair.joinIntro')}</AppText>
          {failure ? <Banner tone="error" message={failure} /> : null}
          <Button
            label={t('pair.joinYes')}
            loading={join.isPending}
            onPress={() => join.mutate(token)}
          />
        </>
      )}
    </Screen>
  );
}

export default function JoinPairRoute() {
  return (
    <RequireSession>
      <JoinPair />
    </RequireSession>
  );
}
