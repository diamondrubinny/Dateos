import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { PersonRow } from '../../components/PersonRow';
import { Screen } from '../../components/Screen';
import { useConversations } from '../../lib/chat-queries';

export default function Matches() {
  const { t } = useTranslation();
  const conversations = useConversations();
  if (conversations.isPending) return <Loading />;
  return (
    <Screen title={t('matches.title')}>
      {conversations.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {conversations.data?.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('matches.empty')}
        </AppText>
      ) : null}
      {conversations.data?.map((c) => {
        const last = c.lastMessage;
        const preview = !last
          ? t('chat.newMatch')
          : last.hidden
            ? t('chat.hidden')
            : last.kind === 'image'
              ? t('chat.photo')
              : last.mine
                ? t('chat.you', { text: last.body ?? '' })
                : (last.body ?? '');
        return (
          <PersonRow
            key={c.matchId}
            profile={c.profile}
            detail={c.unread > 0 ? t('chat.unread', { count: c.unread }) : undefined}
            quote={preview}
            plainQuote
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.matchId } })}
          />
        );
      })}
    </Screen>
  );
}
