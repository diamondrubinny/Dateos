// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { TAKE_NAME_MAX, TAKE_TEXT_MAX, takeRelations, type TakeRelation } from '@nexaheart/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { Loading } from '../../components/Loading';
import { PoweredBy } from '../../components/PoweredBy';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { ApiRequestError } from '../../lib/api';
import { takeLinkInfo, writeTake } from '../../lib/friend-queries';
import { useInstance } from '../../lib/queries';
import { Captcha } from '../../components/Captcha';

/**
 * A friend writes a take (phase 22). No account needed: the page shows only the member's first
 * name, says exactly where the words will appear and who decides, and asks for no contact details.
 */
export default function WriteTake() {
  const { t } = useTranslation();
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const [name, setName] = useState<string>();
  const [dead, setDead] = useState(false);
  const [friend, setFriend] = useState('');
  const [relation, setRelation] = useState<TakeRelation>('friend');
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const needsCaptcha = Boolean(useInstance().data?.integrations.captcha);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);

  useEffect(() => {
    takeLinkInfo(token)
      .then((info) => setName(info.name))
      .catch(() => setDead(true));
  }, [token]);

  if (dead) {
    return (
      <Screen title={t('takes.writeTitleGeneric')}>
        <Banner tone="info" message={t('takes.deadLink')} />
        <PoweredBy />
      </Screen>
    );
  }
  if (!name) return <Loading />;

  const submit = async () => {
    setError(undefined);
    if (!friend.trim()) return setError(t('takes.nameRequired'));
    if (text.trim().length < 10) return setError(t('takes.tooShort'));
    if (needsCaptcha && !captcha) return setError(t('captcha.needed'));
    setSending(true);
    try {
      await writeTake(token, { name: friend.trim(), relation, text: text.trim() }, captcha);
      setDone(true);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 403) {
        setCaptcha(null);
        setCaptchaRound((n) => n + 1);
      }
      setError(
        e instanceof ApiRequestError && e.status === 403
          ? t('captcha.needed')
          : e instanceof ApiRequestError && e.status === 422
            ? t('takes.notAllowed')
            : e instanceof ApiRequestError && e.status === 404
              ? t('takes.deadLink')
              : t('common.genericError'),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen
      title={t('takes.writeTitle', { name })}
      footer={
        done ? undefined : (
          <Button label={t('takes.send')} loading={sending} onPress={() => void submit()} />
        )
      }
    >
      {done ? (
        <Banner tone="success" message={t('takes.thanks', { name })} />
      ) : (
        <>
          <AppText variant="body">{t('takes.writeIntro', { name })}</AppText>
          <AppText variant="caption" tone="muted">
            {t('takes.writePrivacy', { name })}
          </AppText>
          {error ? <Banner tone="error" message={error} /> : null}
          <TextField
            label={t('takes.yourName')}
            value={friend}
            onChangeText={(v) => setFriend(v.slice(0, TAKE_NAME_MAX))}
            maxLength={TAKE_NAME_MAX}
            autoComplete="given-name"
          />
          <ChoiceGroup
            label={t('takes.relation', { name })}
            options={takeRelations.map((value) => ({
              value,
              label: t(`takes.relations.${value}`),
            }))}
            selected={[relation]}
            onChange={([v]) => v && setRelation(v)}
          />
          <TextField
            label={t('takes.text', { name })}
            hint={t('takes.textHint', { count: text.length, max: TAKE_TEXT_MAX })}
            value={text}
            onChangeText={(v) => setText(v.slice(0, TAKE_TEXT_MAX))}
            maxLength={TAKE_TEXT_MAX}
            multiline
          />
          <Captcha onToken={setCaptcha} resetKey={captchaRound} />
        </>
      )}
      <PoweredBy />
    </Screen>
  );
}
