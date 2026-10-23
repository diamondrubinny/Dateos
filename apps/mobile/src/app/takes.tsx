// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_SHOWN_TAKES } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import {
  createTakeLink,
  shareLink,
  takeUrl,
  useApproveTake,
  useMyTakes,
  useRemoveTake,
} from '../lib/friend-queries';
import { radius, spacing, useColors } from '../lib/theme';

/** Friends' takes (phase 22): ask a friend, then approve what they wrote before it's shown. */
function Takes() {
  const { t } = useTranslation();
  const colors = useColors();
  const takes = useMyTakes();
  const approve = useApproveTake();
  const remove = useRemoveTake();
  const [link, setLink] = useState<string>();
  const [status, setStatus] = useState<'shared' | 'copied' | 'shown'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (takes.isPending) return <Loading />;
  const list = takes.data ?? [];
  const approved = list.filter((x) => x.status === 'approved').length;

  const ask = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { token } = await createTakeLink();
      const url = takeUrl(token);
      setLink(url);
      setStatus(await shareLink(url, t('takes.shareMessage')));
    } catch {
      setError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('takes.title')}>
      <AppText variant="body" tone="muted">
        {t('takes.intro', { max: MAX_SHOWN_TAKES })}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {status === 'copied' ? <Banner tone="success" message={t('takes.copied')} /> : null}
      {link ? (
        <AppText variant="caption" selectable testID="take-link" style={styles.link}>
          {link}
        </AppText>
      ) : null}
      <Button label={t('takes.ask')} loading={busy} onPress={() => void ask()} />

      {list.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('takes.empty')}
        </AppText>
      ) : null}
      {list.map((take) => (
        <View
          key={take.id}
          style={[styles.card, { backgroundColor: colors.surface }]}
          testID={`take-${take.status}`}
        >
          <AppText variant="label" tone={take.status === 'approved' ? 'success' : 'primary'}>
            {take.status === 'approved' ? t('takes.shown') : t('takes.pending')}
          </AppText>
          <AppText variant="body" userContent>
            {t('ghosting.quote', { message: take.text })}
          </AppText>
          <AppText variant="caption" tone="muted" userContent>
            {t('takes.byline', {
              name: take.name,
              relation: t(`takes.relations.${take.relation}`),
            })}
          </AppText>
          {take.status === 'pending' ? (
            <View style={styles.actions}>
              <Button
                label={t('takes.approve')}
                disabled={approved >= MAX_SHOWN_TAKES}
                hint={
                  approved >= MAX_SHOWN_TAKES
                    ? t('takes.full', { max: MAX_SHOWN_TAKES })
                    : undefined
                }
                loading={approve.isPending && approve.variables === take.id}
                onPress={() =>
                  approve.mutate(take.id, { onError: () => setError(t('common.genericError')) })
                }
              />
              <Button
                variant="ghost"
                label={t('takes.decline')}
                onPress={() =>
                  remove.mutate(take.id, { onError: () => setError(t('common.genericError')) })
                }
              />
            </View>
          ) : (
            <Button
              variant="dangerGhost"
              label={t('takes.remove')}
              onPress={() =>
                remove.mutate(take.id, { onError: () => setError(t('common.genericError')) })
              }
            />
          )}
        </View>
      ))}
    </Screen>
  );
}

export default function TakesScreen() {
  return (
    <RequireSession>
      <Takes />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  actions: { gap: spacing.sm },
  link: { writingDirection: 'ltr' },
});
