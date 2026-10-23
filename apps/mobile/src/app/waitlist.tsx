// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { WAITLIST_NOTE_MAX } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Captcha } from '../components/Captcha';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { useInstance } from '../lib/queries';
import { joinWaitlist } from '../lib/trust-queries';

const emailSchema = z.email();

/** Waitlist mode (phase 21): leave an address; a moderator approves, and we email when you're in. */
export default function Waitlist() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const needsCaptcha = Boolean(useInstance().data?.integrations.captcha);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);

  const submit = async () => {
    const value = email.trim();
    if (!emailSchema.safeParse(value).success) return setError(t('signIn.invalidEmail'));
    setError(undefined);
    if (needsCaptcha && !captcha) return setError(t('captcha.needed'));
    setSending(true);
    try {
      await joinWaitlist({ email: value, ...(note.trim() ? { note: note.trim() } : {}) }, captcha);
      setDone(true);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 403) {
        setCaptcha(null);
        setCaptchaRound((n) => n + 1);
        setError(t('captcha.needed'));
        return;
      }
      setError(t('common.genericError'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen
      back
      title={t('signup.waitlistTitle')}
      subtitle={t('signup.waitlistIntro')}
      footer={
        done ? undefined : (
          <Button
            label={t('signup.joinWaitlist')}
            loading={sending}
            onPress={() => void submit()}
          />
        )
      }
    >
      {done ? (
        <Banner tone="success" message={t('signup.waitlistDone')} />
      ) : (
        <>
          <TextField
            label={t('signIn.email')}
            error={error}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
            style={{ writingDirection: 'ltr' }}
          />
          <TextField
            label={t('signup.note')}
            hint={t('signup.noteHint', { max: WAITLIST_NOTE_MAX })}
            value={note}
            onChangeText={(v) => setNote(v.slice(0, WAITLIST_NOTE_MAX))}
            maxLength={WAITLIST_NOTE_MAX}
            multiline
          />
          <Captcha onToken={setCaptcha} resetKey={captchaRound} />
        </>
      )}
    </Screen>
  );
}
