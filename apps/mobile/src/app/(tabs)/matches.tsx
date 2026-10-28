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
import { waitingForMyReply, type Conversation } from '@nexaheart/shared';
import { useState } from 'react';
import { useDrafts } from '../../lib/drafts';
import { StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { CheckinEntry } from '../../components/CheckinEntry';
import { EventsEntry } from '../../components/EventCard';
import { DoubleChats } from '../../components/DoubleChats';
import { PartnerMatches } from '../../components/PartnerMatches';
import { useConversations } from '../../lib/chat-queries';
import { useClosedConversations, useDismissClosed } from '../../lib/checkin-queries';
import { useFederatedMatches } from '../../lib/federated-queries';
import { radius, spacing, useColors } from '../../lib/theme';

export default function Matches() {
  const { t } = useTranslation();
  const colors = useColors();
  const conversations = useConversations();
  const closed = useClosedConversations();
  const dismiss = useDismissClosed();
  const partnerMatches = useFederatedMatches();
  // Archived chats (phase 31) sit in their own section, closed by default.
  const [showArchived, setShowArchived] = useState(false);
  // Drafts (phase 38) live on this device only.
  const drafts = useDrafts();
  if (conversations.isPending) return <Loading />;
  const active = conversations.data?.filter((c) => !c.archived) ?? [];
  const draftText = drafts.data ?? {};
  const archived = conversations.data?.filter((c) => c.archived) ?? [];
  const row = (c: Conversation) => {
    const last = c.lastMessage;
    const preview = !last
      ? t('chat.newMatch')
      : last.unsent
        ? t('chatControl.unsent')
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
    const draft = draftText[c.matchId];
    return (
      <PersonRow
        key={c.matchId}
        profile={c.profile}
        detail={
          c.pinned && c.unread === 0
            ? `📌 ${t('chatPrefs.pinned')}`
            : c.mode === 'friend' && c.unread === 0
              ? t('friends.label')
              : c.unread > 0
                ? t('chat.unread', { count: c.unread })
                : waitingForMyReply(last)
                  ? t('ghosting.waiting')
                  : c.muted
                    ? `🔕 ${t('chatPrefs.muted')}`
                    : undefined
        }
        quote={draft ? t('chat.draft', { text: draft }) : preview}
        plainQuote
        onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.matchId } })}
      />
    );
  };
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
      <PartnerMatches />
      {conversations.data?.length === 0 && !partnerMatches.data?.length ? (
        <AppText variant="body" tone="muted">
          {t('matches.empty')}
        </AppText>
      ) : null}
      {active.map(row)}
      {archived.length > 0 ? (
        <Button
          variant="ghost"
          label={t(showArchived ? 'chatPrefs.hideArchived' : 'chatPrefs.showArchived', {
            count: archived.length,
          })}
          onPress={() => setShowArchived(!showArchived)}
          testID="archived-toggle"
        />
      ) : null}
      {showArchived ? archived.map(row) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  closed: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
});
