// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  ageAnswers,
  childrenAnswers,
  distanceAnswers,
  type InterestKey,
  interestKeys,
  intentions,
  MATCHMAKER_TEXT_MAX,
  MAX_INTERESTS,
  type MatchmakerChange,
  type MatchmakerChoices,
  type MatchmakerSuggestion,
  smokingAnswers,
} from '@nexaheart/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox, ChoiceGroup } from '../components/Choice';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { apiFetch, ApiRequestError, json } from '../lib/api';
import { radius, spacing, useColors } from '../lib/theme';

type Step = 'looking' | 'distance' | 'ages' | 'enjoy' | 'smoking' | 'children' | 'text';
const steps: Step[] = ['looking', 'distance', 'ages', 'enjoy', 'smoking', 'children', 'text'];

interface Result {
  suggestions: MatchmakerSuggestion[];
  usedText: boolean;
  textSkipped: 'needs_consent' | 'unavailable' | null;
}

/** The matchmaker (phase 23): a few questions, then suggested changes you choose to apply. */
function MatchmakerScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const client = useQueryClient();
  const info = useQuery({
    queryKey: ['matchmaker'],
    queryFn: () =>
      apiFetch<{ text: 'available' | 'needs_consent' | 'unavailable' }>('/v1/me/matchmaker'),
  });
  const [step, setStep] = useState(0);
  const [choices, setChoices] = useState<MatchmakerChoices>({});
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [applied, setApplied] = useState(false);

  const current = steps[step]!;
  const pick = <K extends keyof MatchmakerChoices>(key: K, value: MatchmakerChoices[K]) =>
    setChoices((c) => ({ ...c, [key]: value }));
  const single = <T extends string>(
    key: Exclude<keyof MatchmakerChoices, 'enjoy'>,
    values: readonly T[],
    label: (v: T) => string,
  ) => (
    <ChoiceGroup
      label={t(`matchmaker.q.${key}`)}
      stacked
      options={values.map((value) => ({ value, label: label(value) }))}
      selected={choices[key] ? [choices[key] as T] : []}
      onChange={(next) => pick(key, next[next.length - 1] as never)}
    />
  );

  const suggest = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await apiFetch<Result>('/v1/me/matchmaker/suggest', {
        method: 'POST',
        body: json({ choices, text: text.trim() }),
      });
      setResult(res);
      setChosen(new Set(res.suggestions.map((s) => s.change.field)));
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 429
          ? t('matchmaker.limit')
          : t('common.genericError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    const changes = result.suggestions.map((s) => s.change).filter((c) => chosen.has(c.field));
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch('/v1/me/matchmaker/apply', { method: 'POST', body: json({ changes }) });
      setApplied(true);
      // Discover changes with the new settings.
      await client.invalidateQueries();
    } catch {
      setError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  };

  /** A setting as words: "up to 15 km", "ages 28-38", "only non-smokers". */
  const describe = (change: MatchmakerChange['field'], value: unknown): string => {
    switch (change) {
      case 'intention':
        return value ? t(`intention.${value as string}`) : t('matchmaker.notSet');
      case 'maxDistanceKm':
        return t('matchmaker.km', { km: value as number });
      case 'ages': {
        const a = value as { ageMin: number; ageMax: number } | null;
        return a ? t('matchmaker.ages', { min: a.ageMin, max: a.ageMax }) : t('matchmaker.notSet');
      }
      case 'interests': {
        const list = value as InterestKey[];
        return list.length ? list.map((i) => t(`interest.${i}`)).join(', ') : t('matchmaker.none');
      }
      case 'smokingOk':
        return (value as string[]).length ? t('matchmaker.nonSmokers') : t('matchmaker.anyone');
      case 'childrenOk': {
        const list = value as string[];
        return list.length === 0
          ? t('matchmaker.anyone')
          : list.includes('want')
            ? t('matchmaker.wantsChildren')
            : t('matchmaker.noChildren');
      }
    }
  };

  if (applied) {
    return (
      <Screen back title={t('matchmaker.title')}>
        <AppText variant="heading" accessibilityLiveRegion="polite" testID="matchmaker-done">
          {t('matchmaker.applied')}
        </AppText>
        <Button label={t('matchmaker.toDiscover')} onPress={() => router.replace('/discover')} />
      </Screen>
    );
  }

  if (result) {
    return (
      <Screen
        back
        title={t('matchmaker.title')}
        footer={
          result.suggestions.length > 0 ? (
            <Button
              label={t('matchmaker.apply', { count: chosen.size })}
              disabled={chosen.size === 0}
              loading={busy}
              onPress={() => void apply()}
            />
          ) : undefined
        }
      >
        <AppText variant="heading" accessibilityRole="header">
          {t('matchmaker.resultTitle')}
        </AppText>
        {result.textSkipped ? (
          <Banner
            tone="info"
            message={
              result.textSkipped === 'needs_consent'
                ? t('matchmaker.textNeedsConsent')
                : t('matchmaker.textUnavailable')
            }
          />
        ) : null}
        {error ? <Banner tone="error" message={error} /> : null}
        {result.suggestions.length === 0 ? (
          <AppText variant="body">{t('matchmaker.nothing')}</AppText>
        ) : (
          <View style={styles.list} testID="matchmaker-suggestions">
            <AppText variant="body" tone="muted">
              {t('matchmaker.resultIntro')}
            </AppText>
            {result.suggestions.map((s) => (
              <View key={s.change.field} style={[styles.card, { backgroundColor: colors.surface }]}>
                <Checkbox
                  label={t(`matchmaker.field.${s.change.field}`)}
                  hint={t('matchmaker.fromTo', {
                    from: describe(s.change.field, s.current),
                    to: describe(s.change.field, s.change.value),
                  })}
                  checked={chosen.has(s.change.field)}
                  onChange={(on) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(s.change.field);
                      else next.delete(s.change.field);
                      return next;
                    })
                  }
                />
              </View>
            ))}
          </View>
        )}
        <Button
          variant="ghost"
          label={t('matchmaker.again')}
          onPress={() => setResult(undefined)}
        />
      </Screen>
    );
  }

  const last = step === steps.length - 1;
  return (
    <Screen
      back
      title={t('matchmaker.title')}
      footer={
        <View style={styles.nav}>
          {step > 0 ? (
            <Button
              variant="secondary"
              label={t('common.back')}
              onPress={() => setStep(step - 1)}
            />
          ) : null}
          <Button
            label={last ? t('matchmaker.see') : t('matchmaker.next')}
            loading={busy}
            onPress={() => (last ? void suggest() : setStep(step + 1))}
          />
        </View>
      }
    >
      {step === 0 ? (
        <AppText variant="body" tone="muted">
          {t('matchmaker.intro')}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
        {t('matchmaker.progress', { n: step + 1, total: steps.length })}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <View testID={`matchmaker-${current}`} style={styles.list}>
        {current === 'looking' ? single('looking', intentions, (v) => t(`intention.${v}`)) : null}
        {current === 'distance'
          ? single('distance', distanceAnswers, (v) => t(`matchmaker.a.distance.${v}`))
          : null}
        {current === 'ages' ? single('ages', ageAnswers, (v) => t(`matchmaker.a.ages.${v}`)) : null}
        {current === 'enjoy' ? (
          <ChoiceGroup
            label={t('matchmaker.q.enjoy', { max: MAX_INTERESTS })}
            multiple
            options={interestKeys.map((value) => ({ value, label: t(`interest.${value}`) }))}
            selected={choices.enjoy ?? []}
            onChange={(next) => pick('enjoy', next.slice(0, MAX_INTERESTS))}
          />
        ) : null}
        {current === 'smoking'
          ? single('smoking', smokingAnswers, (v) => t(`matchmaker.a.smoking.${v}`))
          : null}
        {current === 'children'
          ? single('children', childrenAnswers, (v) => t(`matchmaker.a.children.${v}`))
          : null}
        {current === 'text' ? (
          <>
            <TextField
              label={t('matchmaker.q.text')}
              hint={
                info.data?.text === 'available'
                  ? t('matchmaker.textHint', { max: MATCHMAKER_TEXT_MAX })
                  : info.data?.text === 'needs_consent'
                    ? t('matchmaker.textNeedsConsent')
                    : t('matchmaker.textUnavailable')
              }
              optionalLabel={t('common.optional')}
              value={text}
              onChangeText={(v) => setText(v.slice(0, MATCHMAKER_TEXT_MAX))}
              multiline
              editable={info.data?.text === 'available'}
            />
            <AppText variant="caption" tone="muted">
              {t('matchmaker.privacy')}
            </AppText>
          </>
        ) : null}
      </View>
      {!last ? (
        <Button variant="ghost" label={t('matchmaker.skip')} onPress={() => setStep(step + 1)} />
      ) : null}
    </Screen>
  );
}

export default function MatchmakerRoute() {
  return (
    <RequireSession>
      <MatchmakerScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { padding: spacing.sm, borderRadius: radius.md },
  nav: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end', flexWrap: 'wrap' },
});
