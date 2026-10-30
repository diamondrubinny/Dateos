// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  faiths,
  observanceAnswers,
  questionsFor,
  RELIGION_CONSENT_VERSION,
  streamsFor,
  type Faith,
  type FaithAnswers,
  type FaithStream,
  type ObservanceAnswer,
} from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox, ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { useInstance, useMe, useSetConsents, useSetFaith } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

const NONE = 'none';

/**
 * Faith, stream and observance (phase 62b): only where the community turned the module on, and
 * with the religion consent. Every answer is optional; only the questions that fit the faith.
 */
function FaithEditor() {
  const { t } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const instance = useInstance();
  const save = useSetFaith();
  const consents = useSetConsents();
  const [value, setValue] = useState<FaithAnswers>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (value === undefined && me.data) setValue(me.data.faith);
  }, [me.data, value]);
  if (!me.data || !value || !instance.data) return <Loading />;

  const offered = instance.data.community?.faith ?? false;
  const allowed = me.data.consents.religion === true;
  const streams = streamsFor(value.faith);
  const questions = questionsFor(value.faith);

  const chooseFaith = (next: string | undefined) => {
    const faith = next && next !== NONE ? (next as Faith) : null;
    // A stream or question from another faith doesn't carry over.
    const keep = questionsFor(faith);
    setValue({
      faith,
      stream: value.stream && streamsFor(faith).includes(value.stream) ? value.stream : null,
      observance: Object.fromEntries(
        Object.entries(value.observance).filter(([q]) => (keep as string[]).includes(q)),
      ),
    });
  };

  const submit = async () => {
    setError(undefined);
    try {
      await save.mutateAsync(value);
      if (router.canGoBack()) router.back();
    } catch {
      setError(t('common.genericError'));
    }
  };

  return (
    <Screen
      back
      title={t('faith.title')}
      footer={
        offered && allowed ? (
          <Button label={t('common.save')} loading={save.isPending} onPress={() => void submit()} />
        ) : undefined
      }
    >
      {!offered ? (
        <AppText variant="body">{t('faith.notOffered')}</AppText>
      ) : (
        <>
          <AppText variant="body" tone="muted">
            {t('faith.intro')}
          </AppText>
          {error ? <Banner tone="error" message={error} /> : null}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Checkbox
              label={t('about.religionConsent')}
              hint={t('about.religionConsentHint')}
              checked={allowed}
              onChange={(granted) =>
                consents.mutate(
                  [{ kind: 'religion', granted, version: RELIGION_CONSENT_VERSION }],
                  {
                    // Withdrawing deletes the answers on the server; mirror that here.
                    onSuccess: () =>
                      !granted && setValue({ faith: null, stream: null, observance: {} }),
                    onError: () => setError(t('common.genericError')),
                  },
                )
              }
            />
          </View>
          {allowed ? (
            <>
              <ChoiceGroup<string>
                label={t('faith.faith')}
                stacked
                options={[
                  ...faiths.map((f) => ({ value: f, label: t(`faith.faiths.${f}`) })),
                  { value: NONE, label: t('about.noAnswer') },
                ]}
                selected={[value.faith ?? NONE]}
                onChange={([next]) => chooseFaith(next)}
              />
              {streams.length > 0 ? (
                <ChoiceGroup<string>
                  label={t('faith.stream')}
                  stacked
                  options={[
                    ...streams.map((s) => ({ value: s, label: t(`faith.streams.${s}`) })),
                    { value: NONE, label: t('about.noAnswer') },
                  ]}
                  selected={[value.stream ?? NONE]}
                  onChange={([next]) =>
                    setValue({
                      ...value,
                      stream: next && next !== NONE ? (next as FaithStream) : null,
                    })
                  }
                />
              ) : null}
              {questions.map((q) => (
                <ChoiceGroup<string>
                  key={q}
                  label={t(`faith.questions.${q}`)}
                  options={[
                    ...observanceAnswers.map((a) => ({ value: a, label: t(`faith.answers.${a}`) })),
                    { value: NONE, label: t('about.noAnswer') },
                  ]}
                  selected={[value.observance[q] ?? NONE]}
                  onChange={([next]) => {
                    const observance = { ...value.observance };
                    if (next && next !== NONE) observance[q] = next as ObservanceAnswer;
                    else delete observance[q];
                    setValue({ ...value, observance });
                  }}
                />
              ))}
              <AppText variant="caption" tone="muted">
                {t('faith.never')}
              </AppText>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

export default function EditFaithScreen() {
  return (
    <RequireSession>
      <FaithEditor />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
});
