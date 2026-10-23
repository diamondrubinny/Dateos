// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { genders, MAX_AGE, MIN_AGE, type FriendMode, type Gender } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox, ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useFriendMode, useSetFriendMode } from '../lib/friend-queries';

/** Friends mode settings (phase 22): a separate deck, its own ages and optional genders. */
function FriendModeScreen() {
  const { t } = useTranslation();
  const current = useFriendMode();
  const save = useSetFriendMode();
  const [form, setForm] = useState<FriendMode>();
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!form && current.data) {
      setForm(current.data);
      setMin(String(current.data.ageMin));
      setMax(String(current.data.ageMax));
    }
  }, [current.data, form]);
  if (!form) return <Loading />;

  const ageMin = Number(min);
  const ageMax = Number(max);
  const agesValid =
    Number.isInteger(ageMin) &&
    Number.isInteger(ageMax) &&
    ageMin >= MIN_AGE &&
    ageMax <= MAX_AGE &&
    ageMin <= ageMax;

  const submit = () => {
    setError(undefined);
    if (!agesValid) return setError(t('friends.agesInvalid', { min: MIN_AGE, max: MAX_AGE }));
    save.mutate(
      { ...form, ageMin, ageMax },
      {
        onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/discover')),
        onError: () => setError(t('common.genericError')),
      },
    );
  };

  return (
    <Screen
      back
      title={t('friends.modeTitle')}
      footer={<Button label={t('common.save')} loading={save.isPending} onPress={submit} />}
    >
      <AppText variant="body" tone="muted">
        {t('friends.modeIntro')}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <Checkbox
        label={t('friends.modeOn')}
        hint={t('friends.modeOnHint')}
        checked={form.on}
        onChange={(on) => setForm({ ...form, on })}
      />
      <TextField
        label={t('friends.ageMin')}
        value={min}
        onChangeText={(v) => setMin(v.replace(/[^0-9]/g, '').slice(0, 3))}
        keyboardType="number-pad"
      />
      <TextField
        label={t('friends.ageMax')}
        value={max}
        onChangeText={(v) => setMax(v.replace(/[^0-9]/g, '').slice(0, 3))}
        keyboardType="number-pad"
        error={agesValid ? undefined : t('friends.agesInvalid', { min: MIN_AGE, max: MAX_AGE })}
      />
      <ChoiceGroup
        label={t('friends.genders')}
        multiple
        options={genders.map((value) => ({ value, label: t(`gender.${value}`) }))}
        selected={form.genders}
        onChange={(next) => setForm({ ...form, genders: next as Gender[] })}
      />
      <AppText variant="caption" tone="muted">
        {t('friends.gendersHint')}
      </AppText>
    </Screen>
  );
}

export default function FriendModeRoute() {
  return (
    <RequireSession>
      <FriendModeScreen />
    </RequireSession>
  );
}
