// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_PROMPTS, promptKeys, type PromptKey } from '@nexaheart/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useMe, useSetPrompts } from '../../lib/queries';
import { ONBOARDING_TOTAL } from '../../lib/routes';
import { radius, spacing, useColors } from '../../lib/theme';

export default function PromptsStep() {
  const { t } = useTranslation();
  // Opened from the profile to edit (not during onboarding): go back when done.
  const editing = useLocalSearchParams<{ edit?: string }>().edit === '1';
  const colors = useColors();
  const me = useMe();
  const save = useSetPrompts();
  const [selected, setSelected] = useState<PromptKey[]>([]);
  const [answers, setAnswers] = useState<Partial<Record<PromptKey, string>>>({});
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!me.data || selected.length > 0) return;
    setSelected(me.data.prompts.map((p) => p.promptKey));
    setAnswers(Object.fromEntries(me.data.prompts.map((p) => [p.promptKey, p.answer])));
  }, [me.data, selected.length]);

  const choose = (next: PromptKey[]) => setSelected(next.slice(0, MAX_PROMPTS));

  const submit = async () => {
    const items = selected
      .map((promptKey) => ({ promptKey, answer: (answers[promptKey] ?? '').trim() }))
      .filter((item) => item.answer.length > 0);
    if (items.length === 0) return setError(t('onboarding.prompts.needOne'));
    setError(undefined);
    try {
      await save.mutateAsync(items);
      if (editing) router.back();
      else router.replace('/');
    } catch {
      setError(t('common.genericError'));
    }
  };

  return (
    <Screen
      title={t('onboarding.prompts.title')}
      subtitle={t('onboarding.prompts.subtitle')}
      {...(editing ? { back: true } : { step: { current: 4, total: ONBOARDING_TOTAL } })}
      footer={
        <Button
          label={t('onboarding.done')}
          loading={save.isPending}
          onPress={() => void submit()}
        />
      }
    >
      {error ? <Banner tone="error" message={error} /> : null}
      <ChoiceGroup
        label={t('onboarding.prompts.choose')}
        multiple
        options={promptKeys.map((value) => ({ value, label: t(`prompt.${value}`) }))}
        selected={selected}
        onChange={choose}
      />
      {selected.map((key) => (
        <View
          key={key}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <TextField
            label={t(`prompt.${key}`)}
            value={answers[key] ?? ''}
            onChangeText={(text) => setAnswers((prev) => ({ ...prev, [key]: text }))}
            placeholder={t('onboarding.prompts.answer')}
            multiline
            maxLength={300}
          />
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
});
