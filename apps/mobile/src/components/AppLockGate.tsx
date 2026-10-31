// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';
import { authClient } from '../lib/auth-client';
import { clearDrafts } from '../lib/drafts';
import { checkLock, clearLock, hasLock, LOCK_AFTER_MS, MAX_TRIES, WAIT_MS } from '../lib/app-lock';
import { spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { TextField } from './TextField';

/**
 * Phase 67a: when a lock code is set on this device, the app asks for it when it opens and after
 * LOCK_AFTER_MS away. Nothing of the app is shown until then.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    void hasLock().then((locked) => setState(locked ? 'locked' : 'open'));
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        hiddenAt.current ??= Date.now();
        return;
      }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      if (away >= LOCK_AFTER_MS) {
        void hasLock().then((locked) => locked && setState('locked'));
      }
    });
    return () => sub.remove();
  }, []);

  if (state === 'checking') return null;
  if (state === 'locked') return <LockScreen onOpen={() => setState('open')} />;
  return <>{children}</>;
}

function LockScreen({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [tries, setTries] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    if (Date.now() < waitUntil) {
      setError(t('appLock.wait', { seconds: Math.ceil((waitUntil - Date.now()) / 1000) }));
      return;
    }
    setBusy(true);
    const ok = await checkLock(code);
    setBusy(false);
    if (ok) {
      onOpen();
      return;
    }
    const next = tries + 1;
    setTries(next);
    setCode('');
    if (next >= MAX_TRIES) {
      setTries(0);
      setWaitUntil(Date.now() + WAIT_MS);
      setError(t('appLock.wait', { seconds: WAIT_MS / 1000 }));
    } else {
      setError(t('appLock.wrong'));
    }
  };

  // Forgetting the code: sign out on this device (which removes the code and drafts).
  const forgot = async () => {
    await clearLock();
    await clearDrafts();
    await authClient.signOut().catch(() => undefined);
    onOpen();
    router.replace('/welcome');
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]} testID="app-lock">
      <AppText variant="title" role="heading">
        🔒 {t('appLock.locked')}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <TextField
        label={t('appLock.code')}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))}
        secureTextEntry
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        onSubmitEditing={() => void unlock()}
      />
      <Button label={t('appLock.open')} loading={busy} onPress={() => void unlock()} />
      <Button variant="ghost" label={t('appLock.forgot')} onPress={() => void forgot()} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center' },
});
