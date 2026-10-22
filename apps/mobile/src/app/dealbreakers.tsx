// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  childrenOptions,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  religionOptions,
  smokingOptions,
  type Dealbreakers,
} from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useMe, useSetDealbreakers } from '../lib/queries';

const cm = (text: string) => (text.trim() === '' ? null : Number(text));
const validCm = (v: number | null) =>
  v === null || (Number.isInteger(v) && v >= HEIGHT_MIN_CM && v <= HEIGHT_MAX_CM);

/** Dealbreakers (phase 19): nothing selected means "any"; people who didn't answer always pass. */
function DealbreakersScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const save = useSetDealbreakers();
  const [d, setD] = useState<Dealbreakers>();
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (d === undefined && me.data) {
      setD(me.data.dealbreakers);
      setMin(me.data.dealbreakers.heightMin ? String(me.data.dealbreakers.heightMin) : '');
      setMax(me.data.dealbreakers.heightMax ? String(me.data.dealbreakers.heightMax) : '');
    }
  }, [me.data, d]);
  if (!me.data || !d) return <Loading />;

  const heightMin = cm(min);
  const heightMax = cm(max);
  const heightError =
    !validCm(heightMin) || !validCm(heightMax)
      ? t('about.heightHint', { min: HEIGHT_MIN_CM, max: HEIGHT_MAX_CM })
      : heightMin !== null && heightMax !== null && heightMin > heightMax
        ? t('deal.heightOrder')
        : undefined;

  const submit = async () => {
    setError(undefined);
    if (heightError) return setError(heightError);
    try {
      await save.mutateAsync({ ...d, heightMin, heightMax });
      if (router.canGoBack()) router.back();
      else router.replace('/settings');
    } catch {
      setError(t('common.genericError'));
    }
  };

  return (
    <Screen
      back
      title={t('deal.title')}
      footer={
        <Button label={t('common.save')} loading={save.isPending} onPress={() => void submit()} />
      }
    >
      <AppText variant="body" tone="muted">
        {t('deal.intro')}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <ChoiceGroup
        label={t('deal.smoking')}
        multiple
        options={smokingOptions.map((value) => ({
          value,
          label: t(`about.smokingOptions.${value}`),
        }))}
        selected={d.smokingOk}
        onChange={(smokingOk) => setD({ ...d, smokingOk })}
      />
      <ChoiceGroup
        label={t('deal.children')}
        multiple
        stacked
        options={childrenOptions.map((value) => ({
          value,
          label: t(`about.childrenOptions.${value}`),
        }))}
        selected={d.childrenOk}
        onChange={(childrenOk) => setD({ ...d, childrenOk })}
      />
      {me.data.consents.religion ? (
        <ChoiceGroup
          label={t('deal.religion')}
          multiple
          options={religionOptions.map((value) => ({
            value,
            label: t(`about.religionOptions.${value}`),
          }))}
          selected={d.religionOk}
          onChange={(religionOk) => setD({ ...d, religionOk })}
        />
      ) : (
        <AppText variant="caption" tone="muted">
          {t('deal.religionNeedsConsent')}
        </AppText>
      )}
      <TextField
        label={t('deal.heightMin')}
        value={min}
        onChangeText={(v) => setMin(v.replace(/[^0-9]/g, '').slice(0, 3))}
        keyboardType="number-pad"
      />
      <TextField
        label={t('deal.heightMax')}
        value={max}
        onChangeText={(v) => setMax(v.replace(/[^0-9]/g, '').slice(0, 3))}
        keyboardType="number-pad"
        error={heightError}
      />
    </Screen>
  );
}

export default function Dealbreakers() {
  return (
    <RequireSession>
      <DealbreakersScreen />
    </RequireSession>
  );
}
