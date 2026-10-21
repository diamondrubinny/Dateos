import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { PersonRow } from '../../components/PersonRow';
import { Screen } from '../../components/Screen';
import { useLocale } from '../../lib/locale';
import { useMatches } from '../../lib/queries';

export default function Matches() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const matches = useMatches();
  if (matches.isPending) return <Loading />;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
  return (
    <Screen title={t('matches.title')} subtitle={t('matches.chatSoon')}>
      {matches.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {matches.data?.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('matches.empty')}
        </AppText>
      ) : null}
      {matches.data?.map((match) => (
        <PersonRow
          key={match.id}
          profile={match.profile}
          detail={t('matches.matchedOn', { date: date(match.createdAt) })}
          onPress={() =>
            router.push({
              pathname: '/profile/[id]',
              params: { id: match.profile.id, matchId: match.id },
            })
          }
        />
      ))}
    </Screen>
  );
}
