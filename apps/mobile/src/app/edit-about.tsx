// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  childrenOptions,
  relationshipHistories,
  drinkingOptions,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  interestKeys,
  MAX_INTERESTS,
  OPENING_QUESTION_MAX,
  openingSuggestions,
  RELIGION_CONSENT_VERSION,
  religionOptions,
  smokingOptions,
  type About,
} from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox, ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { VoicePromptEditor } from '../components/VoicePromptEditor';
import { ApiRequestError } from '../lib/api';
import { useMe, useSetAbout, useSetConsents } from '../lib/queries';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';

/** "No answer" is offered in every single-choice group, so nothing here is ever required. */
const NONE = 'none';
const choice = <T extends string>(value: T | null) => (value === null ? NONE : value);
const fromChoice = <T extends string>(value: string | undefined): T | null =>
  !value || value === NONE ? null : (value as T);

/** About me (phase 19): interests, lifestyle, religious observance (with consent), a question. */
function EditAbout() {
  const { t } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const save = useSetAbout();
  const consents = useSetConsents();
  const [about, setAbout] = useState<About>();
  const [height, setHeight] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (about === undefined && me.data) {
      setAbout(me.data.about);
      setHeight(me.data.about.heightCm ? String(me.data.about.heightCm) : '');
    }
  }, [me.data, about]);
  if (!me.data || !about) return <Loading />;

  const religionAllowed = me.data.consents.religion === true;
  const set = (patch: Partial<About>) => setAbout({ ...about, ...patch });
  const heightValue = height.trim() === '' ? null : Number(height);
  const heightInvalid =
    heightValue !== null &&
    (!Number.isInteger(heightValue) || heightValue < HEIGHT_MIN_CM || heightValue > HEIGHT_MAX_CM);

  const submit = async () => {
    setError(undefined);
    if (heightInvalid) return setError(t('about.heightInvalid'));
    try {
      await save.mutateAsync({ ...about, heightCm: heightValue });
      // Opened from a link there may be no screen to go back to.
      if (router.canGoBack()) router.back();
      else router.replace('/profile');
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 400
          ? t('about.invalid')
          : t('common.genericError'),
      );
    }
  };

  const single = <T extends string>(
    key: 'children' | 'smoking' | 'drinking' | 'religion' | 'relationshipHistory',
    options: readonly T[],
  ) => (
    <ChoiceGroup
      label={t(`about.${key}`)}
      stacked={key === 'children' || key === 'relationshipHistory'}
      options={[
        ...options.map((value) => ({
          value: value as string,
          label: t(`about.${key}Options.${value}`),
        })),
        { value: NONE, label: t('about.noAnswer') },
      ]}
      selected={[choice(about[key] as T | null)]}
      onChange={(next) => set({ [key]: fromChoice<T>(next[0]) } as Partial<About>)}
    />
  );

  return (
    <Screen
      back
      title={t('about.title')}
      footer={
        <Button label={t('common.save')} loading={save.isPending} onPress={() => void submit()} />
      }
    >
      <AppText variant="body" tone="muted">
        {t('about.intro')}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}

      <ChoiceGroup
        label={t('about.interests', { count: about.interests.length, max: MAX_INTERESTS })}
        multiple
        options={interestKeys.map((value) => ({ value, label: t(`interest.${value}`) }))}
        selected={about.interests}
        onChange={(next) => set({ interests: next.slice(0, MAX_INTERESTS) })}
      />

      {single('relationshipHistory', relationshipHistories)}
      {single('children', childrenOptions)}
      {single('smoking', smokingOptions)}
      {single('drinking', drinkingOptions)}
      <TextField
        label={t('about.height')}
        hint={t('about.heightHint', { min: HEIGHT_MIN_CM, max: HEIGHT_MAX_CM })}
        value={height}
        onChangeText={(v) => setHeight(v.replace(/[^0-9]/g, '').slice(0, 3))}
        keyboardType="number-pad"
        error={heightInvalid ? t('about.heightInvalid') : undefined}
      />

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <AppText variant="heading">{t('about.religionTitle')}</AppText>
        <Checkbox
          label={t('about.religionConsent')}
          hint={t('about.religionConsentHint')}
          checked={religionAllowed}
          onChange={(granted) =>
            consents.mutate([{ kind: 'religion', granted, version: RELIGION_CONSENT_VERSION }], {
              onSuccess: () => !granted && set({ religion: null }),
              onError: () => setError(t('common.genericError')),
            })
          }
        />
        {religionAllowed ? single('religion', religionOptions) : null}
      </View>

      <VoicePromptEditor />

      <AppText variant="heading">{t('about.questionTitle')}</AppText>
      <AppText variant="body" tone="muted">
        {t('about.questionHint')}
      </AppText>
      <View
        style={styles.suggestions}
        role="list"
        accessibilityLabel={t('about.questionSuggestions')}
      >
        {openingSuggestions.map((key) => (
          <View key={key} role="listitem">
            <Pressable
              accessibilityRole="button"
              onPress={() => set({ openingQuestion: t(`about.suggestion.${key}`) })}
              style={[styles.suggestion, { borderColor: colors.primary }]}
            >
              <AppText variant="body" tone="primary">
                {t(`about.suggestion.${key}`)}
              </AppText>
            </Pressable>
          </View>
        ))}
      </View>
      <TextField
        label={t('about.question')}
        value={about.openingQuestion ?? ''}
        onChangeText={(v) => set({ openingQuestion: v.slice(0, OPENING_QUESTION_MAX) || null })}
        maxLength={OPENING_QUESTION_MAX}
        hint={t('about.questionCount', {
          count: (about.openingQuestion ?? '').length,
          max: OPENING_QUESTION_MAX,
        })}
      />
    </Screen>
  );
}

export default function EditAboutScreen() {
  return (
    <RequireSession>
      <EditAbout />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  suggestions: { gap: spacing.sm },
  suggestion: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
  },
});
