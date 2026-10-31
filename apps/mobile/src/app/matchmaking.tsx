// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { genders, MAX_INTRODUCTION_NOTE, type ConsoleMember, type Gender } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox, ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RemoteImage } from '../components/RemoteImage';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { useIntroduce, useMatchmakerConsole } from '../lib/introduction-queries';
import { radius, spacing, useColors } from '../lib/theme';

/**
 * Phase 68a: the community matchmaker's console. Only members open to matchmakers are listed;
 * pick two, write why, send. Each answers privately.
 */
function Matchmaking() {
  const { t } = useTranslation();
  const colors = useColors();
  const [q, setQ] = useState('');
  const [gender, setGender] = useState<Gender>();
  const data = useMatchmakerConsole({ q: q.trim() || undefined, gender });
  const introduce = useIntroduce();
  const [chosen, setChosen] = useState<ConsoleMember[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  if (data.error instanceof ApiRequestError && data.error.status === 403) {
    return (
      <Screen back title={t('console.title')}>
        <Banner tone="info" message={t('console.notMatchmaker')} />
      </Screen>
    );
  }
  if (!data.data) return <Loading />;
  const { members, left } = data.data;

  const toggle = (m: ConsoleMember, on: boolean) => {
    setSent(false);
    setChosen((list) =>
      on ? [...list.filter((x) => x.id !== m.id), m].slice(-2) : list.filter((x) => x.id !== m.id),
    );
  };

  const send = () => {
    const [a, b] = chosen;
    if (!a || !b || !note.trim()) return;
    setError(undefined);
    introduce.mutate(
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
                ? t('console.limit')
                : t('common.genericError'),
          ),
      },
    );
  };

  return (
    <Screen back title={t('console.title')}>
      <AppText variant="body">{t('console.intro')}</AppText>
      <AppText variant="caption" tone="muted">
        {t('console.left', { count: left })}
      </AppText>
      {sent ? <Banner tone="success" message={t('console.sent')} /> : null}
      {error ? <Banner tone="error" message={error} /> : null}

      <TextField
        label={t('console.search')}
        value={q}
        onChangeText={setQ}
        maxLength={60}
        autoCapitalize="none"
      />
      <ChoiceGroup<Gender>
        label={t('console.gender')}
        options={genders.map((g) => ({ value: g, label: t(`gender.${g}`) }))}
        selected={gender ? [gender] : []}
        onChange={([g]) => setGender(g === gender ? undefined : g)}
      />

      {members.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('console.empty')}
        </AppText>
      ) : (
        <View style={styles.list} role="list" accessibilityLabel={t('console.members')}>
          {members.map((m) => (
            <View
              key={m.id}
              role="listitem"
              testID="console-member"
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <View style={styles.person}>
                {m.photoUrl ? (
                  <RemoteImage path={m.photoUrl} label={m.displayName} style={styles.thumb} />
                ) : null}
                <AppText variant="heading" userContent>
                  {m.displayName}, {m.age}
                </AppText>
              </View>
              <Button
                variant="ghost"
                label={t('console.profile', { name: m.displayName })}
                onPress={() => router.push(`/profile/${m.id}`)}
              />
              <Checkbox
                label={t('console.choose', { name: m.displayName })}
                checked={chosen.some((x) => x.id === m.id)}
                onChange={(on) => toggle(m, on)}
              />
            </View>
          ))}
        </View>
      )}

      <View style={[styles.compose, { borderColor: colors.border }]} testID="console-compose">
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
          loading={introduce.isPending}
          disabled={chosen.length !== 2 || !note.trim() || left === 0}
          onPress={send}
        />
      </View>

      <AppText variant="heading">{t('console.sentTitle')}</AppText>
      {data.data.sent.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('console.noneSent')}
        </AppText>
      ) : (
        <View style={styles.list} role="list" accessibilityLabel={t('console.sentTitle')}>
          {data.data.sent.map((s) => (
            <View
              key={s.id}
              role="listitem"
              testID="console-sent"
              style={[styles.row, { borderColor: colors.border }]}
            >
              <AppText variant="label" userContent>
                {t('console.pair', { a: s.a.displayName, b: s.b.displayName })}
              </AppText>
              <AppText variant="caption" tone={s.state === 'matched' ? 'success' : 'muted'}>
                {t(`console.state.${s.state}`)}
                {s.outcome ? ` · ${t(`intro.outcome.${s.outcome}`)}` : ''}
              </AppText>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

export default function MatchmakingRoute() {
  return (
    <RequireSession>
      <Matchmaking />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
  compose: { borderTopWidth: 1, paddingTop: spacing.md, gap: spacing.sm },
});
