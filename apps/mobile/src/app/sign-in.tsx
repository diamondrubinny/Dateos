// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Captcha } from '../components/Captcha';
import { PoweredBy } from '../components/PoweredBy';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { requestMagicLink } from '../lib/magic-link';
import { useInstance } from '../lib/queries';
import { spacing } from '../lib/theme';
import { passkeysSupported, redeemInvite, signInWithPasskey } from '../lib/trust-queries';

const emailSchema = z.email();

export default function SignIn() {
  const { t } = useTranslation();
  const instance = useInstance();
  const mode = instance.data?.signup ?? 'open';
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyFailed, setPasskeyFailed] = useState(false);
  // Bot protection (phase 24): only when the community set one up.
  const needsCaptcha = Boolean(instance.data?.integrations.captcha);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [captchaError, setCaptchaError] = useState(false);

  const submit = async () => {
    const value = email.trim();
    if (!emailSchema.safeParse(value).success) return setFieldError(t('signIn.invalidEmail'));
    setFieldError(undefined);
    setCodeError(undefined);
    setFailed(false);
    setCaptchaError(false);
    if (needsCaptcha && !captcha) return setCaptchaError(true);
    setSending(true);
    try {
      // Invite mode (phase 21): a code entered here lets this address open an account first.
      if (mode === 'invite' && code.trim()) {
        try {
          await redeemInvite({ code: code.trim(), email: value });
        } catch (e) {
          if (e instanceof ApiRequestError && e.status === 400) {
            return setCodeError(t('signup.badCode'));
          }
          throw e;
        }
      }
      const ok = await requestMagicLink(value, captcha).catch(() => false);
      if (ok === 'captcha') {
        // Answers are single use: ask again.
        setCaptcha(null);
        setCaptchaRound((n) => n + 1);
        return setCaptchaError(true);
      }
      if (!ok) return setFailed(true);
      router.push({ pathname: '/check-email', params: { email: value } });
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const passkey = async () => {
    setPasskeyFailed(false);
    setPasskeyBusy(true);
    const ok = await signInWithPasskey().catch(() => false);
    setPasskeyBusy(false);
    if (ok) router.replace('/');
    else setPasskeyFailed(true);
  };

  return (
    <Screen
      back
      title={t('signIn.title')}
      subtitle={t('signIn.subtitle')}
      footer={<Button label={t('signIn.submit')} loading={sending} onPress={() => void submit()} />}
    >
      {failed ? <Banner tone="error" message={t('common.genericError')} /> : null}
      <TextField
        label={t('signIn.email')}
        hint={t('signIn.emailHint')}
        error={fieldError}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        inputMode="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
        style={{ writingDirection: 'ltr' }}
      />

      {mode === 'invite' ? (
        <TextField
          label={t('signup.code')}
          hint={t('signup.codeHint')}
          error={codeError}
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={24}
          style={{ writingDirection: 'ltr' }}
        />
      ) : null}
      {mode === 'waitlist' ? (
        <View style={styles.box}>
          <AppText variant="body" tone="muted">
            {t('signup.waitlistHint')}
          </AppText>
          <Button
            variant="secondary"
            label={t('signup.joinWaitlist')}
            onPress={() => router.push('/waitlist')}
          />
        </View>
      ) : null}

      {needsCaptcha ? (
        <View style={styles.box}>
          <Captcha onToken={setCaptcha} resetKey={captchaRound} />
          {captchaError ? <Banner tone="error" message={t('captcha.needed')} /> : null}
        </View>
      ) : null}

      {instance.data?.auth.passkey && passkeysSupported() ? (
        <View style={styles.box}>
          {passkeyFailed ? <Banner tone="error" message={t('passkey.signInFailed')} /> : null}
          <Button
            variant="ghost"
            label={t('passkey.signIn')}
            loading={passkeyBusy}
            onPress={() => void passkey()}
          />
        </View>
      ) : null}
      <PoweredBy />
    </Screen>
  );
}

const styles = StyleSheet.create({ box: { gap: spacing.sm } });
