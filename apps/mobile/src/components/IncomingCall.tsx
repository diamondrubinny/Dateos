// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { CALL_RING_SECONDS } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import { declineCall } from '../lib/call-queries';
import { useConversations } from '../lib/chat-queries';
import { useRealtime } from '../lib/realtime';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { RemoteImage } from './RemoteImage';

interface Ringing {
  callId: string;
  matchId: string;
  video: boolean;
}

/**
 * The invitation, wherever the person is in the app. Nothing rings by itself: the other person
 * chooses Join or Not now, and it goes away when the caller hangs up or the time runs out.
 */
export function IncomingCall() {
  const { t } = useTranslation();
  const colors = useColors();
  const realtime = useRealtime();
  const conversations = useConversations();
  const [ringing, setRinging] = useState<Ringing>();

  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (event.type === 'call.incoming') {
          setRinging({ callId: event.callId, matchId: event.matchId, video: event.video });
          void conversations.refetch();
        }
        if (event.type === 'call.updated' && event.status !== 'ringing') {
          setRinging((r) => (r?.callId === event.callId ? undefined : r));
        }
        if (event.type === 'match.closed') {
          setRinging((r) => (r?.matchId === event.matchId ? undefined : r));
        }
      }),
    [realtime, conversations],
  );

  useEffect(() => {
    if (!ringing) return;
    const timer = setTimeout(() => setRinging(undefined), CALL_RING_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [ringing]);

  if (!ringing) return null;
  const profile = conversations.data?.find((c) => c.matchId === ringing.matchId)?.profile;
  const name = profile?.displayName ?? '';
  const title = ringing.video
    ? t('call.incomingVideo', { name })
    : t('call.incomingVoice', { name });

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setRinging(undefined)}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
        <View
          style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}
          role="alertdialog"
          aria-modal
          aria-label={title}
          accessibilityViewIsModal
        >
          {profile?.photos[0] ? (
            <RemoteImage path={profile.photos[0].url} label={name} style={styles.avatar} />
          ) : null}
          <AppText
            variant="title"
            center
            accessibilityRole="header"
            accessibilityLiveRegion="assertive"
          >
            {title}
          </AppText>
          <AppText variant="body" tone="muted" center>
            {t('call.incomingHint')}
          </AppText>
          <Button
            label={t('call.join')}
            onPress={() => {
              const { callId } = ringing;
              setRinging(undefined);
              router.push({ pathname: '/call/[id]', params: { id: callId } });
            }}
          />
          <Button
            variant="ghost"
            label={t('call.notNow')}
            onPress={() => {
              void declineCall(ringing.callId).catch(() => undefined);
              setRinging(undefined);
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    alignItems: 'stretch',
  },
  avatar: { width: 96, height: 96, borderRadius: 48, alignSelf: 'center' },
});
