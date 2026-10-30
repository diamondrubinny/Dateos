// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_APPEAL_TEXT, MIN_APPEAL_TEXT, type Decision } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useAppeal, useDecisions } from '../lib/safety-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { Loading } from './Loading';
import { TextField } from './TextField';

/**
 * Phase 61: each decision about my account, with its reasons (what, why, the ground, whether an
 * automatic check found it) and the appeal: the form while it can be made, then its state.
 */
export function AccountDecisions({ emptyText }: { emptyText?: string }) {
  const { t } = useTranslation();
  const decisions = useDecisions();
  if (decisions.isPending) return <Loading />;
  if (decisions.isError) return <Banner tone="error" message={t('common.genericError')} />;
  const list = decisions.data.decisions;
  if (list.length === 0) {
    return emptyText ? <AppText variant="body">{emptyText}</AppText> : null;
  }
  return (
    <View style={styles.list}>
      {list.map((d) => (
        <DecisionCard key={d.id} decision={d} />
      ))}
    </View>
  );
}

function DecisionCard({ decision: d }: { decision: Decision }) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  const category = d.category ? t(`report.categories.${d.category}`) : null;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID={`decision-${d.action}`}
    >
      <AppText variant="heading">{t(`decisions.action.${d.action}`)}</AppText>
      <AppText variant="caption" tone="muted">
        {date(d.createdAt)}
      </AppText>
      {d.reversed ? <Banner tone="success" message={t('decisions.reversed')} /> : null}

      <AppText variant="label">{t('decisions.why')}</AppText>
      {category ? (
        <AppText variant="body">
          {t(d.ground === 'illegal' ? 'decisions.groundIllegal' : 'decisions.groundTerms', {
            category,
          })}
        </AppText>
      ) : null}
      <AppText variant="body" testID="decision-explanation">
        {d.explanation ?? t('decisions.noExplanation')}
      </AppText>
      <AppText variant="caption" tone="muted">
        {d.automatedDetection ? t('decisions.automated') : t('decisions.byPerson')}
      </AppText>

      <Appeal decision={d} date={date} />
    </View>
  );
}

function Appeal({ decision: d, date }: { decision: Decision; date: (iso: string) => string }) {
  const { t } = useTranslation();
  const appeal = useAppeal();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();

  if (d.appeal) {
    const a = d.appeal;
    return (
      <View style={styles.appeal} testID={`appeal-${a.status}`}>
        <AppText variant="label">{t('decisions.appealTitle')}</AppText>
        <AppText variant="body">
          {a.status === 'open'
            ? t('decisions.appealOpen', { date: date(a.createdAt) })
            : a.status === 'reversed'
              ? t('decisions.appealReversed')
              : t('decisions.appealUpheld')}
        </AppText>
        {a.response ? (
          <>
            <AppText variant="label">{t('decisions.reply')}</AppText>
            <AppText variant="body" testID="appeal-reply">
              {a.response}
            </AppText>
          </>
        ) : null}
      </View>
    );
  }
  if (d.reversed) return null;
  if (!d.canAppeal) {
    return (
      <AppText variant="caption" tone="muted">
        {t('decisions.appealClosed')}
      </AppText>
    );
  }

  const tooShort = text.trim().length < MIN_APPEAL_TEXT;
  const send = () => {
    if (tooShort) {
      setError(t('decisions.appealTooShort', { min: MIN_APPEAL_TEXT }));
      return;
    }
    setError(undefined);
    appeal.mutate(
      { id: d.id, text: text.trim() },
      {
        onError: (e) =>
          setError(
            e instanceof ApiRequestError && e.status === 409
              ? t('decisions.appealConflict')
              : t('common.genericError'),
          ),
      },
    );
  };

  return (
    <View style={styles.appeal}>
      <AppText variant="label">{t('decisions.appealTitle')}</AppText>
      <AppText variant="body">{t('decisions.appealIntro', { date: date(d.appealUntil) })}</AppText>
      <TextField
        label={t('decisions.appealLabel')}
        hint={t('decisions.appealHint', { count: text.length, max: MAX_APPEAL_TEXT })}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={MAX_APPEAL_TEXT}
        error={error}
      />
      <Button label={t('decisions.appealSend')} loading={appeal.isPending} onPress={send} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.lg },
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm, borderWidth: 1 },
  appeal: { gap: spacing.sm, marginTop: spacing.sm },
});
