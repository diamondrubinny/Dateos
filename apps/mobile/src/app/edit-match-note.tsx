// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_MATCH_NOTE } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { useMe, useSetMatchNote } from '../lib/queries';

/**
 * Phase 66b, Match Note: what a match should know before meeting, shown only to people the member
 * matched with (never strangers or partner communities).
 */
function EditMatchNote() {
  const { t } = useTranslation();
  const me = useMe();
  const save = useSetMatchNote();
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (note === undefined && me.data) setNote(me.data.matchNote ?? '');
  }, [me.data, note]);
  if (!me.data || note === undefined) return <Loading />;

  const submit = async (value: string | null) => {
    setError(undefined);
    try {
      await save.mutateAsync(value);
      router.back();
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 403
          ? t('matchNote.needsConsent')
          : e instanceof ApiRequestError && e.status === 400
            ? t('matchNote.invalid')
            : t('common.genericError'),
      );
    }
  };

  return (
    <Screen
      back
      title={t('matchNote.title')}
      footer={
        <Button
          label={t('common.save')}
          loading={save.isPending}
          onPress={() => void submit(note.trim() ? note.trim() : null)}
        />
      }
    >
      <AppText variant="body">{t('matchNote.intro')}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <TextField
        label={t('matchNote.label')}
        hint={t('matchNote.hint')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={MAX_MATCH_NOTE}
      />
      {me.data.matchNote ? (
        <Button
          variant="dangerGhost"
          label={t('matchNote.delete')}
          onPress={() => void submit(null)}
        />
      ) : null}
    </Screen>
  );
}

export default function EditMatchNoteRoute() {
  return (
    <RequireSession>
      <EditMatchNote />
    </RequireSession>
  );
}
