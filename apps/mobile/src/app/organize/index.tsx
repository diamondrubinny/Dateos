// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_PENDING_PROPOSALS, type EventProposal } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { formatEventTime } from '../../components/EventCard';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { ApiRequestError } from '../../lib/api';
import { useVenues } from '../../lib/date-queries';
import { useOrganizerHome, useProposalAction } from '../../lib/event-queries';
import { useLocale } from '../../lib/locale';
import { radius, spacing, useColors } from '../../lib/theme';

const pad = (n: number) => String(n).padStart(2, '0');
const inDays = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Community organizers (phase 71e): propose an in-person event at one of the community's places;
 * an admin approves or declines it. My approved events can be run from here.
 */
function Organize() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const home = useOrganizerHome();
  const venues = useVenues();
  const action = useProposalAction();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState(inDays(7));
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('21:00');
  const [capacity, setCapacity] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  if (home.isPending) return <Loading />;
  if (!home.data?.organizer) {
    return (
      <Screen back title={t('organize.title')}>
        <Banner tone="info" message={t('organize.notOrganizer')} />
      </Screen>
    );
  }
  const { proposals, events } = home.data;
  const pending = proposals.filter((p) => p.status === 'pending').length;

  const submit = () => {
    setMessage(undefined);
    const startsAt = new Date(`${date}T${start}`);
    const endsAt = new Date(`${date}T${end}`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setMessage({ tone: 'error', text: t('organize.badTime') });
      return;
    }
    if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);
    action.mutate(
      {
        propose: {
          title: title.trim(),
          description: description.trim(),
          venueId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          capacity: capacity.trim() === '' ? null : Number(capacity),
        },
      },
      {
        onSuccess: () => {
          setTitle('');
          setDescription('');
          setMessage({ tone: 'success', text: t('organize.sent') });
        },
        onError: (e) =>
          setMessage({
            tone: 'error',
            text:
              e instanceof ApiRequestError && e.status === 429
                ? t('organize.tooMany', { n: MAX_PENDING_PROPOSALS })
                : e instanceof ApiRequestError && (e.status === 422 || e.status === 400)
                  ? t('organize.badTime')
                  : t('common.genericError'),
          }),
      },
    );
  };

  const status = (p: EventProposal) =>
    p.status === 'declined'
      ? t('organize.declined', { reason: p.reason ?? '' })
      : t(`organize.status.${p.status}`);

  return (
    <Screen back title={t('organize.title')}>
      <AppText variant="body">{t('organize.intro')}</AppText>
      {events.length > 0 ? (
        <>
          <AppText variant="heading" accessibilityRole="header">
            {t('organize.myEvents')}
          </AppText>
          <View role="list" style={styles.list}>
            {events.map((e) => (
              <View
                key={e.id}
                role="listitem"
                style={[styles.card, { backgroundColor: colors.surface }]}
              >
                <AppText variant="label" userContent>
                  {e.title}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {formatEventTime(e, locale)} · {t('events.goingCount', { count: e.going })}
                </AppText>
                <Button
                  variant="secondary"
                  label={t('organize.run')}
                  hint={e.title}
                  onPress={() => router.push({ pathname: '/organize/[id]', params: { id: e.id } })}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}

      <AppText variant="heading" accessibilityRole="header">
        {t('organize.proposeTitle')}
      </AppText>
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
      <TextField label={t('organize.name')} value={title} onChangeText={setTitle} maxLength={80} />
      <TextField
        label={t('organize.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={1000}
      />
      <ChoiceGroup
        label={t('organize.place')}
        stacked
        options={(venues.data ?? []).map((v) => ({ value: v.id, label: `${v.name}, ${v.area}` }))}
        selected={venueId ? [venueId] : []}
        onChange={([v]) => v && setVenueId(v)}
      />
      <TextField
        label={t('organize.date')}
        hint={t('organize.dateHint')}
        value={date}
        onChangeText={setDate}
        inputMode="numeric"
        maxLength={10}
      />
      <View style={styles.row}>
        <View style={styles.half}>
          <TextField
            label={t('organize.start')}
            value={start}
            onChangeText={setStart}
            maxLength={5}
          />
        </View>
        <View style={styles.half}>
          <TextField label={t('organize.end')} value={end} onChangeText={setEnd} maxLength={5} />
        </View>
      </View>
      <TextField
        label={t('organize.capacity')}
        hint={t('organize.capacityHint')}
        value={capacity}
        onChangeText={(v) => setCapacity(v.replace(/\D/g, ''))}
        inputMode="numeric"
        maxLength={5}
      />
      <Button
        label={t('organize.send')}
        disabled={title.trim().length < 2 || !venueId || pending >= MAX_PENDING_PROPOSALS}
        loading={action.isPending}
        onPress={submit}
      />

      {proposals.length > 0 ? (
        <>
          <AppText variant="heading" accessibilityRole="header">
            {t('organize.proposals')}
          </AppText>
          <View role="list" style={styles.list}>
            {proposals.map((p) => (
              <View
                key={p.id}
                role="listitem"
                testID="proposal"
                style={[styles.card, { backgroundColor: colors.surface }]}
              >
                <AppText variant="label" userContent>
                  {p.title}
                </AppText>
                <AppText
                  variant="caption"
                  tone={
                    p.status === 'declined'
                      ? 'danger'
                      : p.status === 'approved'
                        ? 'success'
                        : 'muted'
                  }
                >
                  {status(p)}
                </AppText>
                {p.status === 'pending' ? (
                  <Button
                    variant="ghost"
                    label={t('organize.withdraw')}
                    hint={p.title}
                    onPress={() => action.mutate({ withdraw: p.id })}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
});

export default function OrganizeRoute() {
  return (
    <RequireSession>
      <Organize />
    </RequireSession>
  );
}
