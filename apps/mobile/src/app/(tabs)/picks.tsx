import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { PersonRow } from '../../components/PersonRow';
import { Screen } from '../../components/Screen';
import { usePicks } from '../../lib/queries';

export default function Picks() {
  const { t } = useTranslation();
  const picks = usePicks();
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
