// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { intentions, MAX_AGE, MIN_AGE, type Intention } from '@nexaheart/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ChoiceGroup, Checkbox } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { useMe, useSetPreferences } from '../lib/queries';
import { spacing } from '../lib/theme';

const distances = ['5', '10', '25', '50', '100', '250'] as const;

function PreferencesContent() {
  const { t } = useTranslation();
  const me = useMe();
  const save = useSetPreferences();
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [distance, setDistance] = useState<(typeof distances)[number]>('50');
  const [wanted, setWanted] = useState<Intention[]>([]);
  // Phase 34: only people a moderator verified.
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'invalid' | 'error'>();

  const prefs = me.data?.preferences;
  useEffect(() => {
    if (!prefs) return;
    setAgeMin(String(prefs.ageMin));
    setAgeMax(String(prefs.ageMax));
    const closest = distances.find((d) => Number(d) >= prefs.maxDistanceKm) ?? '250';
    setDistance(closest);
    setWanted(prefs.intentions);
    setVerifiedOnly(prefs.verifiedOnly);
  }, [prefs]);

  if (!me.data) return <Loading />;

  const submit = async () => {
    const min = Number(ageMin);
    const max = Number(ageMax);
    if (
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      min < MIN_AGE ||
      max > MAX_AGE ||
      min > max
    ) {
      return setNotice('invalid');
    }
    try {
      await save.mutateAsync({
        ageMin: min,
        ageMax: max,
        maxDistanceKm: Number(distance),
        intentions: wanted,
        verifiedOnly,
      });
      setNotice('saved');
    } catch {
      setNotice('error');
    }
  };

  return (
    <Screen
      back
      title={t('preferences.title')}
      footer={
        <Button label={t('common.save')} loading={save.isPending} onPress={() => void submit()} />
      }
    >
      {notice === 'saved' ? <Banner tone="success" message={t('preferences.saved')} /> : null}
      {notice === 'invalid' ? <Banner tone="error" message={t('preferences.invalidAge')} /> : null}
      {notice === 'error' ? <Banner tone="error" message={t('common.genericError')} /> : null}
      <View style={styles.row}>
        <View style={styles.cell}>
          <TextField
            label={t('preferences.ageMin')}
            value={ageMin}
            onChangeText={setAgeMin}
            inputMode="numeric"
            maxLength={3}
          />
        </View>
        <View style={styles.cell}>
          <TextField
            label={t('preferences.ageMax')}
            value={ageMax}
            onChangeText={setAgeMax}
            inputMode="numeric"
            maxLength={3}
          />
        </View>
      </View>
      <ChoiceGroup
        label={t('preferences.distance')}
        options={distances.map((value) => ({ value, label: t('preferences.km', { km: value }) }))}
        selected={[distance]}
        onChange={([next]) => next && setDistance(next)}
      />
      <ChoiceGroup
        label={t('preferences.intentions')}
        multiple
        options={intentions.map((value) => ({ value, label: t(`intention.${value}`) }))}
        selected={wanted}
        onChange={setWanted}
      />
      <Checkbox
        label={`✓ ${t('preferences.verifiedOnly')}`}
        hint={t('preferences.verifiedOnlyHint')}
        checked={verifiedOnly}
        onChange={setVerifiedOnly}
      />
    </Screen>
  );
}

export default function PreferencesRoute() {
  return (
    <RequireSession>
      <PreferencesContent />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1 },
});
