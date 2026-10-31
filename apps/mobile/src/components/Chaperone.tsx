// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import {
  chaperoneUrl,
  useInviteChaperone,
  useMyChaperone,
  useRemoveChaperone,
} from '../lib/chaperone-queries';
import { shareLink } from '../lib/friend-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * Phase 68d, Settings → "A chaperone": invite one person who reads my dating chats (from now on,
 * text only, with a notice the other side sees), see when they last looked, remove them any time.
 */
export function Chaperone({ onError }: { onError: () => void }) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const state = useMyChaperone();
  const invite = useInviteChaperone();
  const remove = useRemoveChaperone();
  const [link, setLink] = useState<{ url: string; status: string }>();
  const [confirming, setConfirming] = useState(false);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' });
  const current = state.data?.chaperone;

  return (
    <View style={styles.wrap} testID="chaperone-settings">
      <AppText variant="heading">{t('chaperone.title')}</AppText>
      <AppText variant="body">{t('chaperone.intro')}</AppText>
      {current ? (
        <View style={[styles.box, { borderColor: colors.border }]}>
          <AppText variant="label">
            {t('chaperone.current', { name: current.displayName, date: date(current.since) })}
          </AppText>
          <AppText variant="caption" tone="muted">
            {current.lastViewedAt
              ? t('chaperone.lastViewed', { date: date(current.lastViewedAt) })
              : t('chaperone.notViewed')}
          </AppText>
          {confirming ? (
            <>
              <AppText variant="body">
                {t('chaperone.removeConfirm', { name: current.displayName })}
              </AppText>
              <Button
                variant="danger"
                label={t('chaperone.removeYes')}
                loading={remove.isPending}
                onPress={() =>
                  remove.mutate(undefined, { onError, onSuccess: () => setConfirming(false) })
                }
              />
              <Button
                variant="ghost"
                label={t('common.cancel')}
                onPress={() => setConfirming(false)}
              />
            </>
          ) : (
            <Button
              variant="dangerGhost"
              label={t('chaperone.remove', { name: current.displayName })}
              onPress={() => setConfirming(true)}
            />
          )}
        </View>
      ) : (
        <>
          <Button
            variant="secondary"
            label={t('chaperone.invite')}
            loading={invite.isPending}
            onPress={() =>
              invite.mutate(undefined, {
                onError,
                onSuccess: async ({ token }) => {
                  const url = chaperoneUrl(token);
                  setLink({ url, status: await shareLink(url, t('chaperone.shareMessage')) });
                },
              })
            }
          />
          {link ? (
            <View testID="chaperone-link">
              <AppText variant="caption">{t(`resume.made.${link.status}`)}</AppText>
              <AppText variant="caption" selectable>
                {link.url}
              </AppText>
            </View>
          ) : null}
        </>
      )}
      <Button
        variant="ghost"
        label={t('chaperone.iChaperone')}
        onPress={() => router.push('/chaperoning')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
