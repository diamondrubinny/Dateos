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
import { waitingForMyReply } from '@nexaheart/shared';
import { StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { CheckinEntry } from '../../components/CheckinEntry';
import { EventsEntry } from '../../components/EventCard';
import { DoubleChats } from '../../components/DoubleChats';
import { useConversations } from '../../lib/chat-queries';
import { useClosedConversations, useDismissClosed } from '../../lib/checkin-queries';
import { radius, spacing, useColors } from '../../lib/theme';

export default function Matches() {
  const { t } = useTranslation();
  const colors = useColors();
  const conversations = useConversations();
  const closed = useClosedConversations();
  const dismiss = useDismissClosed();
  if (conversations.isPending) return <Loading />;
  return (
    <Screen title={t('matches.title')}>
      {conversations.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      <CheckinEntry />
      <EventsEntry />
      {closed.data?.map((c) => (
        <View key={c.matchId} style={[styles.closed, { backgroundColor: colors.surface }]}>
          <AppText variant="label" userContent>
            {t('ghosting.closedCard', { name: c.name })}
          </AppText>
          <AppText variant="body" userContent>
            {t('ghosting.quote', { message: c.message })}
          </AppText>
          <Button
            variant="ghost"
            label={t('ghosting.dismiss')}
            onPress={() => dismiss.mutate(c.matchId)}
          />
        </View>
      ))}
      <DoubleChats />
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
              : last.kind === 'date' && last.date
                ? t('datePlan.preview', { place: last.date.venue.name })
                : last.kind === 'call' && last.call
                  ? last.call.video
                    ? t('call.previewVideo')
                    : t('call.previewVoice')
                  : last.mine
                    ? t('chat.you', { text: last.body ?? '' })
                    : (last.body ?? '');
        return (
          <PersonRow
            key={c.matchId}
            profile={c.profile}
            detail={
              c.mode === 'friend' && c.unread === 0
                ? t('friends.label')
                : c.unread > 0
                  ? t('chat.unread', { count: c.unread })
                  : waitingForMyReply(last)
                    ? t('ghosting.waiting')
                    : undefined
            }
            quote={preview}
            plainQuote
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.matchId } })}
          />
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  closed: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
});
