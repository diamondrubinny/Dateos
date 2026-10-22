// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Checkin } from '@nexaheart/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { useConversations } from '../lib/chat-queries';
import {
  useActiveCheckin,
  useCancelCheckin,
  useCheckinOk,
  useCheckinSos,
  useCreateCheckin,
} from '../lib/checkin-queries';
import { useLocale } from '../lib/locale';
import { radius, spacing, useColors } from '../lib/theme';

const STARTS = { now: 0, in30: 30, in60: 60, in120: 120 } as const;
const DURATIONS = { h1: 60, h2: 120, h3: 180, h4: 240 } as const;

/** The time, with the day too when it isn't today (a check-in can be set up for a planned date). */
function time(iso: string, locale: string) {
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(locale, {
    ...(today ? {} : { weekday: 'short', day: 'numeric', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function Active({ checkin, onNotice }: { checkin: Checkin; onNotice: (m: string) => void }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const ok = useCheckinOk();
  const sos = useCheckinSos();
  const cancel = useCancelCheckin();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const fail = () => setError(t('common.genericError'));

  return (
    <>
      {error ? <Banner tone="error" message={error} /> : null}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <AppText variant="heading">{t('checkin.activeTitle')}</AppText>
        <AppText variant="body">
          {checkin.status === 'alerted'
            ? t('checkin.alertedBody', { name: checkin.contactName })
            : t('checkin.activeBody', {
                time: time(checkin.checkAt, locale),
                name: checkin.contactName,
                email: checkin.contactEmailMasked,
              })}
        </AppText>
        <AppText variant="body" tone="muted" userContent>
          {checkin.place}
          {checkin.matchName ? ` · ${checkin.matchName}` : ''}
        </AppText>
      </View>
      <Button
        label={t('checkin.ok')}
        loading={ok.isPending}
        onPress={() =>
          ok.mutate(checkin.id, { onSuccess: () => onNotice(t('checkin.okDone')), onError: fail })
        }
      />
      {confirming ? (
        <View
          style={[styles.card, { backgroundColor: colors.dangerSoft }]}
          accessibilityRole="alert"
        >
          <AppText variant="heading" tone="danger">
            {t('checkin.sosConfirmTitle', { name: checkin.contactName })}
          </AppText>
          <AppText variant="body">{t('checkin.sosConfirmBody')}</AppText>
          <Button
            variant="danger"
            label={t('checkin.sosConfirm')}
            loading={sos.isPending}
            onPress={() =>
              sos.mutate(checkin.id, {
                onSuccess: () => {
                  setConfirming(false);
                  onNotice(t('checkin.sosSent', { name: checkin.contactName }));
                },
                onError: fail,
              })
            }
          />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <Button variant="danger" label={t('checkin.sos')} onPress={() => setConfirming(true)} />
      )}
      <Banner tone="info" message={t('checkin.emergency')} />
      <Button
        variant="ghost"
        label={t('checkin.cancel')}
        loading={cancel.isPending}
        onPress={() => cancel.mutate(checkin.id, { onError: fail })}
      />
    </>
  );
}

function NewCheckin({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const create = useCreateCheckin();
  const conversations = useConversations();
  // Opened from an accepted date card: the match, the place and the start time are filled in.
  const planned = useLocalSearchParams<{ matchId?: string; place?: string; startsAt?: string }>();
  const plannedStart =
    planned.startsAt && Date.parse(planned.startsAt) > Date.now() ? planned.startsAt : undefined;
  const [matchId, setMatchId] = useState<string>(planned.matchId ?? 'none');
  const [place, setPlace] = useState(planned.place?.slice(0, 200) ?? '');
  const [start, setStart] = useState<keyof typeof STARTS | 'planned'>(
    plannedStart ? 'planned' : 'now',
  );
  const [duration, setDuration] = useState<keyof typeof DURATIONS>('h2');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();

  const submit = () => {
    setError(undefined);
    if (place.trim().length < 2 || !contactName.trim() || !/^\S+@\S+\.\S+$/.test(contactEmail)) {
      return setError(t('checkin.invalid'));
    }
    const startsAt =
      start === 'planned' && plannedStart
        ? new Date(plannedStart)
        : new Date(Date.now() + STARTS[start === 'planned' ? 'now' : start] * 60_000);
    const checkAt = new Date(startsAt.getTime() + DURATIONS[duration] * 60_000);
    create.mutate(
      {
        ...(matchId !== 'none' ? { matchId } : {}),
        place: place.trim(),
        startsAt: startsAt.toISOString(),
        checkAt: checkAt.toISOString(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        locale,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      {
        onSuccess: onCreated,
        onError: (e) =>
          setError(
            e instanceof ApiRequestError && e.status === 429
              ? t('checkin.limit')
              : t('common.genericError'),
          ),
      },
    );
  };

  const people = (conversations.data ?? []).map((c) => ({
    value: c.matchId,
    label: c.profile.displayName,
  }));
  return (
    <>
      <AppText variant="body">{t('checkin.intro')}</AppText>
      <Banner tone="info" message={t('checkin.emergency')} />
      {error ? <Banner tone="error" message={error} /> : null}
      {people.length > 0 ? (
        <ChoiceGroup
          label={t('checkin.who')}
          options={[...people.slice(0, 8), { value: 'none', label: t('checkin.nobody') }]}
          selected={[matchId]}
          onChange={([v]) => v && setMatchId(v)}
        />
      ) : null}
      <TextField
        label={t('checkin.place')}
        hint={t('checkin.placeHint')}
        value={place}
        onChangeText={setPlace}
        maxLength={200}
      />
      <ChoiceGroup
        label={t('checkin.start')}
        options={[
          ...(plannedStart
            ? [{ value: 'planned' as const, label: time(plannedStart, locale) }]
            : []),
          { value: 'now', label: t('checkin.startNow') },
          { value: 'in30', label: t('checkin.start30') },
          { value: 'in60', label: t('checkin.start60') },
          { value: 'in120', label: t('checkin.start120') },
        ]}
        selected={[start]}
        onChange={([v]) => v && setStart(v)}
      />
      <ChoiceGroup
        label={t('checkin.duration')}
        options={[
          { value: 'h1', label: t('checkin.d1') },
          { value: 'h2', label: t('checkin.d2') },
          { value: 'h3', label: t('checkin.d3') },
          { value: 'h4', label: t('checkin.d4') },
        ]}
        selected={[duration]}
        onChange={([v]) => v && setDuration(v)}
      />
      <TextField
        label={t('checkin.contactName')}
        value={contactName}
        onChangeText={setContactName}
        maxLength={60}
        autoComplete="name"
      />
      <TextField
        label={t('checkin.contactEmail')}
        hint={t('checkin.contactHint')}
        value={contactEmail}
        onChangeText={setContactEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        maxLength={254}
      />
      <TextField
        label={t('checkin.note')}
        hint={t('checkin.noteHint')}
        optionalLabel={t('common.optional')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={300}
      />
      <Button label={t('checkin.create')} loading={create.isPending} onPress={submit} />
    </>
  );
}

function CheckinScreen() {
  const { t } = useTranslation();
  const active = useActiveCheckin();
  const [notice, setNotice] = useState<string>();
  if (active.isPending) return <Loading />;
  return (
    <Screen back title={t('checkin.title')}>
      {notice ? <Banner tone="info" message={notice} /> : null}
      {active.data ? (
        <Active checkin={active.data} onNotice={setNotice} />
      ) : (
        <NewCheckin onCreated={() => setNotice(undefined)} />
      )}
    </Screen>
  );
}

export default function CheckinRoute() {
  return (
    <RequireSession>
      <CheckinScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm },
});
