// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_INTRODUCTION_NOTE } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RemoteImage } from '../components/RemoteImage';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { useFriendSuggestPage, useSuggestFriends } from '../lib/introduction-queries';
import { radius, spacing, useColors } from '../lib/theme';

/**
 * Phase 68c: suggest two of my friends here to each other. They answer privately, as with a
 * community matchmaker; I only see whether it went ahead.
 */
function SuggestFriends() {
  const { t } = useTranslation();
  const colors = useColors();
  const page = useFriendSuggestPage();
  const suggest = useSuggestFriends();
  const [chosen, setChosen] = useState<{ id: string; displayName: string }[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  if (!page.data) return <Loading />;
  const { friends, left } = page.data;

  const send = () => {
    const [a, b] = chosen;
    if (!a || !b || !note.trim()) return;
    setError(undefined);
    suggest.mutate(
      { aId: a.id, bId: b.id, note: note.trim() },
      {
        onSuccess: () => {
          setChosen([]);
          setNote('');
          setSent(true);
        },
        onError: (err) =>
          setError(
            err instanceof ApiRequestError && err.status === 409
              ? t('console.cantIntroduce')
              : err instanceof ApiRequestError && err.status === 429
                ? t('suggest.limit')
                : t('common.genericError'),
          ),
      },
    );
  };

  return (
    <Screen back title={t('suggest.title')}>
      <AppText variant="body">{t('suggest.intro')}</AppText>
      <AppText variant="caption" tone="muted">
        {t('console.left', { count: left })}
      </AppText>
      {sent ? <Banner tone="success" message={t('console.sent')} /> : null}
      {error ? <Banner tone="error" message={error} /> : null}
      {friends.length < 2 ? (
        <AppText variant="body" tone="muted">
          {t('suggest.needTwo')}
        </AppText>
      ) : (
        <>
          <View style={styles.list} role="list" accessibilityLabel={t('suggest.friends')}>
            {friends.map((f) => (
              <View
                key={f.id}
                role="listitem"
                testID="suggest-friend"
                style={[styles.row, { borderColor: colors.border }]}
              >
                {f.photoUrl ? (
                  <RemoteImage path={f.photoUrl} label={f.displayName} style={styles.thumb} />
                ) : null}
                <View style={styles.grow}>
                  <Checkbox
                    label={t('console.choose', { name: f.displayName })}
                    checked={chosen.some((x) => x.id === f.id)}
                    onChange={(on) => {
                      setSent(false);
                      setChosen((list) =>
                        on
                          ? [...list.filter((x) => x.id !== f.id), f].slice(-2)
                          : list.filter((x) => x.id !== f.id),
                      );
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
          <AppText variant="heading">
            {chosen.length === 2
              ? t('console.pair', { a: chosen[0]!.displayName, b: chosen[1]!.displayName })
              : t('console.chooseTwo')}
          </AppText>
          <TextField
            label={t('console.note')}
            hint={t('console.noteHint')}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={MAX_INTRODUCTION_NOTE}
          />
          <Button
            label={t('console.send')}
            loading={suggest.isPending}
            disabled={chosen.length !== 2 || !note.trim() || left === 0}
            onPress={send}
          />
        </>
      )}
      <AppText variant="heading">{t('console.sentTitle')}</AppText>
      {page.data.sent.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('console.noneSent')}
        </AppText>
      ) : (
        page.data.sent.map((s) => (
          <View key={s.id} style={[styles.row, styles.col, { borderColor: colors.border }]}>
            <AppText variant="label" userContent>
              {t('console.pair', { a: s.a.displayName, b: s.b.displayName })}
            </AppText>
            <AppText variant="caption" tone={s.state === 'matched' ? 'success' : 'muted'}>
              {t(`console.state.${s.state}`)}
            </AppText>
          </View>
        ))
      )}
    </Screen>
  );
}

export default function SuggestFriendsRoute() {
  return (
    <RequireSession>
      <SuggestFriends />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  col: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.xs },
  grow: { flex: 1 },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
});
