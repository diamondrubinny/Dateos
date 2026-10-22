import { MAX_CLOSING_MESSAGE_LENGTH } from '@dateos/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { ApiRequestError } from '../../lib/api';
import { useCloseKindly } from '../../lib/checkin-queries';

type Choice = 'template1' | 'template2' | 'template3' | 'own';

/** Anti-ghosting: end a conversation with a kind message the other person will see. */
function CloseKindly() {
  const { t } = useTranslation();
  const { id, name = '' } = useLocalSearchParams<{ id: string; name?: string }>();
  const close = useCloseKindly(id);
  const [choice, setChoice] = useState<Choice>('template1');
  const [own, setOwn] = useState('');
  const [error, setError] = useState<string>();
  const message = choice === 'own' ? own.trim() : t(`ghosting.${choice}`);

  const send = () => {
    setError(undefined);
    if (message.length < 2) return;
    close.mutate(message, {
      onSuccess: () => router.replace('/matches'),
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.status === 422
            ? t('ghosting.hurtful')
            : t('common.genericError'),
        ),
    });
  };

  return (
    <Screen back title={t('ghosting.closeTitle')}>
      <AppText variant="body">{t('ghosting.closeIntro', { name })}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <ChoiceGroup
        label={t('ghosting.ownLabel')}
        options={(['template1', 'template2', 'template3', 'own'] as const).map((value) => ({
          value,
          label: t(value === 'own' ? 'ghosting.own' : `ghosting.${value}`),
        }))}
        selected={[choice]}
        onChange={([v]) => v && setChoice(v)}
        stacked
      />
      {choice === 'own' ? (
        <TextField
          label={t('ghosting.ownLabel')}
          value={own}
          onChangeText={setOwn}
          multiline
          maxLength={MAX_CLOSING_MESSAGE_LENGTH}
        />
      ) : null}
      <Button
        label={t('ghosting.send')}
        loading={close.isPending}
        disabled={message.length < 2}
        onPress={send}
      />
    </Screen>
  );
}

export default function CloseRoute() {
  return (
    <RequireSession>
      <CloseKindly />
    </RequireSession>
  );
}
