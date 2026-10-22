// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { PersonRow } from '../../components/PersonRow';
import { Screen } from '../../components/Screen';
import { OnBreak } from '../../components/OnBreak';
import { usePicks, useMe } from '../../lib/queries';

export default function Picks() {
  const { t } = useTranslation();
  const picks = usePicks();
  const onBreak = Boolean(useMe().data?.pause);
  if (onBreak) {
    return (
      <Screen title={t('picks.title')} subtitle={t('picks.subtitle')}>
        <OnBreak />
      </Screen>
    );
  }
  if (picks.isPending) return <Loading />;
  return (
    <Screen title={t('picks.title')} subtitle={t('picks.subtitle')}>
      {picks.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {picks.data?.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('picks.empty')}
        </AppText>
      ) : null}
      {picks.data?.map((profile) => (
        <PersonRow
          key={profile.id}
          profile={profile}
          onPress={() => router.push(`/profile/${profile.id}`)}
        />
      ))}
    </Screen>
  );
}
