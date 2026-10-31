// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { tableDrinks, tablePaces, tableTalks, type TableAnswers } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useMyTable, useTableAction } from '../lib/event-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { ChoiceGroup } from './Choice';

/**
 * Tables by a short questionnaire (phase 71d): joining is optional and is the consent to share my
 * first name with my table. The table and the first names at it appear when the tables are set.
 */
export function EventTable({ eventId, open }: { eventId: string; open: boolean }) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const table = useMyTable(eventId, true);
  const action = useTableAction(eventId);
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Partial<TableAnswers>>({});
  const [error, setError] = useState(false);
  if (!table.data) return null;
  const { joined, set, tableNo, mates, setAt } = table.data;
  const when = new Date(setAt).toLocaleString(i18n.language, {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  const complete = answers.pace && answers.talk && answers.drinks;
  const submit = (value: TableAnswers | null) => {
    setError(false);
    action.mutate(value, {
      onSuccess: () => setEditing(false),
      onError: () => setError(true),
    });
  };
  const questions = open && (!joined || editing) && !set;

  return (
    <View testID="event-table" style={[styles.card, { backgroundColor: colors.surface }]}>
      <AppText variant="heading" accessibilityRole="header">
        {t('eventTable.title')}
      </AppText>
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {set && tableNo !== null ? (
        <>
          <AppText variant="label" tone="primary" testID="my-table">
            {t('eventTable.yourTable', { n: tableNo })}
          </AppText>
          <AppText variant="body">
            {mates.length > 0
              ? t('eventTable.with', { names: mates.join(', ') })
              : t('eventTable.alone')}
          </AppText>
        </>
      ) : set ? (
        <AppText variant="body">{t('eventTable.setWithoutYou')}</AppText>
      ) : null}
      {joined && !set && !editing ? (
        <>
          <AppText variant="body">{t('eventTable.joined', { when })}</AppText>
          {open ? (
            <View style={styles.row}>
              <Button
                variant="secondary"
                label={t('eventTable.change')}
                onPress={() => {
                  setAnswers(table.data?.answers ?? {});
                  setEditing(true);
                }}
              />
              <Button
                variant="ghost"
                label={t('eventTable.leave')}
                loading={action.isPending}
                onPress={() => submit(null)}
              />
            </View>
          ) : null}
        </>
      ) : null}
      {questions ? (
        <>
          <AppText variant="body">{t('eventTable.intro', { when })}</AppText>
          <ChoiceGroup
            label={t('eventTable.pace')}
            options={tablePaces.map((v) => ({ value: v, label: t(`eventTable.paces.${v}`) }))}
            selected={answers.pace ? [answers.pace] : []}
            onChange={([v]) => v && setAnswers({ ...answers, pace: v })}
          />
          <ChoiceGroup
            label={t('eventTable.talk')}
            options={tableTalks.map((v) => ({ value: v, label: t(`eventTable.talks.${v}`) }))}
            selected={answers.talk ? [answers.talk] : []}
            onChange={([v]) => v && setAnswers({ ...answers, talk: v })}
          />
          <ChoiceGroup
            label={t('eventTable.drinks')}
            options={tableDrinks.map((v) => ({
              value: v,
              label: t(`eventTable.drinkOptions.${v}`),
            }))}
            selected={answers.drinks ? [answers.drinks] : []}
            onChange={([v]) => v && setAnswers({ ...answers, drinks: v })}
          />
          <AppText variant="caption" tone="muted">
            {t('eventTable.consent')}
          </AppText>
          <Button
            label={joined ? t('eventTable.save') : t('eventTable.join')}
            disabled={!complete}
            loading={action.isPending}
            onPress={() => complete && submit(answers as TableAnswers)}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
