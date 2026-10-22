// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { CALL_RING_SECONDS, type MessageView } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { declineCall } from '../lib/call-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/** A call in the chat: who called, how it went, and Join while it can still be joined. */
export function CallLine({ message }: { message: MessageView }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const call = message.call;
  if (!call) return null;

  const kind = call.video ? t('call.video') : t('call.voice');
  const ringing =
    call.status === 'ringing' && Date.parse(call.createdAt) + CALL_RING_SECONDS * 1000 > Date.now();
  const text =
    call.status === 'ended'
      ? t('call.lineEnded', {
          kind,
          minutes: Math.max(1, Math.round((call.durationSeconds ?? 0) / 60)),
        })
      : call.status === 'active'
        ? t('call.lineActive', { kind })
        : ringing
          ? call.mine
            ? t('call.lineCalling', { kind })
            : t('call.lineIncoming', { kind })
          : call.status === 'declined'
            ? call.mine
              ? t('call.lineDeclinedByThem', { kind })
              : t('call.lineDeclinedByYou', { kind })
            : call.mine
              ? t('call.lineNoAnswer', { kind })
              : t('call.lineMissed', { kind });
  const open = () => router.push({ pathname: '/call/[id]', params: { id: call.id } });

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="text"
    >
      <AppText variant="label">
        {call.video ? '🎥' : '📞'} {text}
      </AppText>
      {call.status === 'active' || (ringing && call.mine) ? (
        <Button variant="secondary" label={t('call.rejoin')} onPress={open} />
      ) : null}
      {ringing && !call.mine ? (
        <View style={styles.row}>
          <Button label={t('call.join')} onPress={open} />
          <Button
            variant="ghost"
            label={t('call.notNow')}
            loading={busy}
            onPress={() => {
              setBusy(true);
              declineCall(call.id)
                .catch(() => undefined)
                .finally(() => setBusy(false));
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    maxWidth: '92%',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
