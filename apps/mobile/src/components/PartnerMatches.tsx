// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useFederatedMatches, useFederatedUnmatch } from '../lib/federated-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { RemoteImage } from './RemoteImage';

/** Matches with people from partner communities (phase 28b), and their chats (28c). */
export function PartnerMatches() {
  const { t } = useTranslation();
  const colors = useColors();
  const matches = useFederatedMatches();
  const unmatch = useFederatedUnmatch();
  const [confirm, setConfirm] = useState<string>();
  if (!matches.data?.length) return null;
  return (
    <View style={styles.wrap} testID="partner-matches">
      <AppText variant="heading">{t('partners.matchesTitle')}</AppText>
      {matches.data.map((m) => (
        <View key={m.id} style={[styles.row, { backgroundColor: colors.surface }]}>
          <View style={styles.person}>
            {m.photo ? (
              <RemoteImage path={m.photo.url} label={m.displayName} style={styles.photo} />
            ) : null}
            <View style={styles.text}>
              <AppText variant="label">{m.displayName}</AppText>
              <AppText variant="caption" tone="muted" userContent>
                {t('partners.from', { community: m.community })}
              </AppText>
            </View>
          </View>
          {m.lastMessage ? (
            <AppText variant="body" tone="muted" userContent numberOfLines={2}>
              {m.lastMessage.hidden
                ? t('chat.hidden')
                : m.lastMessage.mine
                  ? t('chat.you', { text: m.lastMessage.body })
                  : m.lastMessage.body}
            </AppText>
          ) : null}
          <Button
            label={
              m.unread > 0
                ? `${t('partners.openChat', { name: m.displayName })} · ${t('chat.unread', { count: m.unread })}`
                : t('partners.openChat', { name: m.displayName })
            }
            onPress={() => router.push({ pathname: '/partner-chat/[id]', params: { id: m.id } })}
          />
          {confirm === m.id ? (
            <>
              <AppText variant="body">
                {t('partners.unmatchConfirm', { name: m.displayName })}
              </AppText>
              <Button
                variant="danger"
                label={t('partners.unmatchYes')}
                loading={unmatch.isPending}
                onPress={() => unmatch.mutate(m.id, { onSuccess: () => setConfirm(undefined) })}
              />
              <Button
                variant="ghost"
                label={t('common.cancel')}
                onPress={() => setConfirm(undefined)}
              />
            </>
          ) : (
            <Button
              variant="dangerGhost"
              label={t('partners.unmatch', { name: m.displayName })}
              onPress={() => setConfirm(m.id)}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  person: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  photo: { width: 56, height: 56, borderRadius: 28 },
  text: { flex: 1, gap: 2 },
});
