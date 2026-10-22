// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  MAX_REPORT_EVIDENCE,
  reportCategories,
  type MessagesPage,
  type ReportCategory,
} from '@nexaheart/shared';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Checkbox, ChoiceGroup } from '../../components/Choice';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { chatKeys } from '../../lib/realtime';
import { useReport } from '../../lib/safety-queries';
import { spacing } from '../../lib/theme';

/** Ids of the latest text messages in the chat (the server copies their content itself). */
async function recentMessageIds(
  client: ReturnType<typeof useQueryClient>,
  matchId: string,
): Promise<string[]> {
  const cached = client.getQueryData<InfiniteData<MessagesPage>>(chatKeys.messages(matchId));
  const pages = cached?.pages ?? [
    await apiFetch<MessagesPage>(`/v1/matches/${matchId}/messages?limit=30`),
  ];
  const all = pages.flatMap((p) => p.messages).filter((m) => m.kind === 'text');
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return all.slice(-MAX_REPORT_EVIDENCE).map((m) => m.id);
}

function ReportScreen() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const {
    id,
    name = '',
    matchId,
  } = useLocalSearchParams<{ id: string; name?: string; matchId?: string }>();
  const report = useReport();
  const [category, setCategory] = useState<ReportCategory>();
  const [details, setDetails] = useState('');
  const [attach, setAttach] = useState(Boolean(matchId));
  const [block, setBlock] = useState(true);
  const [error, setError] = useState<string>();
  const [missingCategory, setMissingCategory] = useState(false);
  const [done, setDone] = useState<string>();

  const submit = async () => {
    setError(undefined);
    setMissingCategory(!category);
    if (!category) return;
    try {
      const messageIds = matchId && attach ? await recentMessageIds(client, matchId) : [];
      await report.mutateAsync({
        targetId: id,
        category,
        ...(details.trim() ? { details: details.trim() } : {}),
        messageIds,
        block,
      });
      setDone(t('report.done'));
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409)
        return setDone(t('report.duplicate', { name }));
      setError(t('common.genericError'));
    }
  };

  const leave = () => {
    // After blocking, the chat and profile no longer exist: go back to the lists.
    if (block) router.replace('/matches');
    else router.back();
  };

  if (done) {
    return (
      <Screen back title={t('report.title', { name })}>
        <Banner tone="success" message={done} />
        <AppText variant="body">{t('report.emergency')}</AppText>
        <Button label={t('common.continue')} onPress={leave} />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t('report.title', { name })}
      subtitle={t('report.intro', { name })}
      footer={
        <Button
          variant="danger"
          label={t('report.submit')}
          loading={report.isPending}
          onPress={() => void submit()}
        />
      }
    >
      {error ? <Banner tone="error" message={error} /> : null}
      <AppText variant="caption" tone="muted">
        {t('report.emergency')}
      </AppText>
      <ChoiceGroup
        label={t('report.category')}
        options={reportCategories.map((value) => ({
          value,
          label: t(`report.categories.${value}`),
        }))}
        selected={category ? [category] : []}
        onChange={(next) => {
          setCategory(next[0]);
          setMissingCategory(false);
        }}
        error={missingCategory ? t('report.pickCategory') : undefined}
      />
      <TextField
        label={t('report.details')}
        hint={t('report.detailsHint')}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={1000}
      />
      <View style={styles.options}>
        {matchId ? (
          <Checkbox
            label={t('report.attach')}
            hint={t('report.attachHint')}
            checked={attach}
            onChange={setAttach}
          />
        ) : null}
        <Checkbox
          label={t('report.block', { name })}
          hint={t('report.blockHint')}
          checked={block}
          onChange={setBlock}
        />
      </View>
    </Screen>
  );
}

export default function ReportRoute() {
  return (
    <RequireSession>
      <ReportScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({ options: { gap: spacing.sm } });
