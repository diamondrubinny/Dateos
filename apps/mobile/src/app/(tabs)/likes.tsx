import type { LikeReceived } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { PersonRow } from '../../components/PersonRow';
import { Screen } from '../../components/Screen';
import { useLikes } from '../../lib/queries';

export default function Likes() {
  const { t } = useTranslation();
  const likes = useLikes();
  if (likes.isPending) return <Loading />;

  const describe = (like: LikeReceived) => {
    if (like.itemType === 'photo') return t('likes.likedPhoto');
    if (like.promptKey) return t('likes.likedPrompt', { prompt: t(`prompt.${like.promptKey}`) });
    return t('likes.likedProfile');
  };

  return (
    <Screen title={t('likes.title')} subtitle={t('likes.subtitle')}>
      {likes.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {likes.data?.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('likes.empty')}
        </AppText>
      ) : null}
      {likes.data?.map((like) => (
        <PersonRow
          key={like.profile.id}
          profile={like.profile}
          detail={describe(like)}
          quote={like.comment}
          onPress={() => router.push(`/profile/${like.profile.id}`)}
        />
      ))}
    </Screen>
  );
}
