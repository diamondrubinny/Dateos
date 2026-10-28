// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { BlockedPerson } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { useBlocked, useUnblock } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

/**
 * Blocked people (phase 35): names only (no photos), newest first, with Unblock after a
 * confirmation. The other person is never told; a match the block closed stays closed.
 */
function Blocked() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const blocked = useBlocked();
  const unblock = useUnblock();
  const [confirming, setConfirming] = useState<string>();
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();

  if (blocked.isPending) return <Loading />;
  const people = blocked.data ?? [];
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const name = (p: BlockedPerson) => p.displayName || t('blocked.noName');

  return (
    <Screen back title={t('blocked.title')}>
      <AppText variant="body">{t('blocked.intro')}</AppText>
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
      {blocked.isError ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {people.length === 0 && !blocked.isError ? (
        <AppText variant="body" tone="muted" testID="blocked-empty">
          {t('blocked.empty')}
        </AppText>
      ) : null}
      <View role="list" style={styles.list}>
        {people.map((p) => (
          <View
            key={p.userId}
            role="listitem"
            style={[styles.row, { backgroundColor: colors.surface }]}
            testID="blocked-person"
          >
            <AppText variant="heading">{name(p)}</AppText>
            <AppText variant="caption" tone="muted">
              {t('blocked.since', { date: when(p.blockedAt) })}
            </AppText>
            {confirming === p.userId ? (
              <>
                <AppText variant="body">{t('blocked.confirm', { name: name(p) })}</AppText>
                <Button
                  label={t('blocked.unblockYes')}
                  loading={unblock.isPending}
                  onPress={() =>
                    unblock.mutate(p.userId, {
                      onSuccess: () => {
                        setConfirming(undefined);
                        setMessage({ tone: 'info', text: t('blocked.done', { name: name(p) }) });
                      },
                      onError: () => setMessage({ tone: 'error', text: t('common.genericError') }),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  label={t('common.cancel')}
                  onPress={() => setConfirming(undefined)}
                />
              </>
            ) : (
              <Button
                variant="secondary"
                label={t('blocked.unblock')}
                hint={t('blocked.unblockHint', { name: name(p) })}
                onPress={() => {
                  setMessage(undefined);
                  setConfirming(p.userId);
                }}
              />
            )}
          </View>
        ))}
      </View>
    </Screen>
  );
}

export default function BlockedScreen() {
  return (
    <RequireSession>
      <Blocked />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
