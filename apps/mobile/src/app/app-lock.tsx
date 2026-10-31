// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { checkLock, clearLock, hasLock, isValidLockCode, setLock } from '../lib/app-lock';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);

/** Phase 67a: set, change or turn off this device's app lock code. */
function AppLockSettings() {
  const { t } = useTranslation();
  const [locked, setLocked] = useState<boolean>();
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  useEffect(() => {
    void hasLock().then(setLocked);
  }, []);
  if (locked === undefined) return <Loading />;

  const reset = () => {
    setCurrent('');
    setCode('');
    setAgain('');
  };
  const save = async () => {
    setError(undefined);
    setDone(undefined);
    if (locked && !(await checkLock(current))) return setError(t('appLock.wrong'));
    if (!isValidLockCode(code)) return setError(t('appLock.invalid'));
    if (code !== again) return setError(t('appLock.mismatch'));
    await setLock(code);
    reset();
    setLocked(true);
    setDone(t('appLock.saved'));
  };
  const turnOff = async () => {
    setError(undefined);
    setDone(undefined);
    if (!(await checkLock(current))) return setError(t('appLock.wrong'));
    await clearLock();
    reset();
    setLocked(false);
    setDone(t('appLock.removed'));
  };

  const field = (label: string, value: string, set: (v: string) => void) => (
    <TextField
      label={label}
      value={value}
      onChangeText={(v) => set(digits(v))}
      secureTextEntry
      keyboardType="number-pad"
      inputMode="numeric"
      autoComplete="off"
      maxLength={8}
    />
  );

  return (
    <Screen back title={t('appLock.title')}>
      <AppText variant="body">{t('appLock.intro')}</AppText>
      <Banner tone="info" message={t('appLock.limits')} />
      {error ? <Banner tone="error" message={error} /> : null}
      {done ? <Banner tone="success" message={done} /> : null}
      <AppText variant="label">{locked ? t('appLock.isOn') : t('appLock.isOff')}</AppText>
      {locked ? field(t('appLock.current'), current, setCurrent) : null}
      {field(t('appLock.newCode'), code, setCode)}
      {field(t('appLock.again'), again, setAgain)}
      <Button
        label={locked ? t('appLock.change') : t('appLock.turnOn')}
        onPress={() => void save()}
      />
      {locked ? (
        <Button variant="dangerGhost" label={t('appLock.turnOff')} onPress={() => void turnOff()} />
      ) : null}
    </Screen>
  );
}

export default function AppLockRoute() {
  return (
    <RequireSession>
      <AppLockSettings />
    </RequireSession>
  );
}
