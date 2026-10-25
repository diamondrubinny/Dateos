// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { reportCategories, type ReportCategory } from '@nexaheart/shared';
import { router, useLocalSearchParams } from 'expo-router';
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
import { ApiRequestError } from '../lib/api';
import { useFederatedReport } from '../lib/federated-queries';
import { spacing } from '../lib/theme';

/**
 * Reporting someone from a partner community (phase 28d): the report goes to their own
 * community's moderators, who handle it with their rules; this community only hears it was reviewed.
 */
function PartnerReportScreen() {
  const { t } = useTranslation();
  const {
    partnerId,
    alias,
    name = '',
    community = '',
    matched,
  } = useLocalSearchParams<{
    partnerId: string;
    alias: string;
    name?: string;
    community?: string;
    matched?: string;
  }>();
  const report = useFederatedReport();
  const [category, setCategory] = useState<ReportCategory>();
  const [details, setDetails] = useState('');
  const [attach, setAttach] = useState(matched === '1');
  const [block, setBlock] = useState(true);
  const [error, setError] = useState<string>();
  const [missingCategory, setMissingCategory] = useState(false);
  const [done, setDone] = useState<string>();

  const submit = async () => {
    setError(undefined);
    setMissingCategory(!category);
    if (!category) return;
    try {
      await report.mutateAsync({
        partnerId,
        alias,
        category,
        ...(details.trim() ? { details: details.trim() } : {}),
        attach,
        block,
      });
      setDone(t('partners.reportDone', { community }));
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        return setDone(t('report.duplicate', { name }));
      }
      setError(t('common.genericError'));
    }
  };

  if (done) {
    return (
      <Screen back title={t('report.title', { name })}>
        <Banner tone="success" message={done} />
        <AppText variant="body">{t('report.emergency')}</AppText>
        <Button
          label={t('common.continue')}
          onPress={() => (block ? router.replace('/matches') : router.back())}
        />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t('report.title', { name })}
      subtitle={t('partners.reportIntro', { name, community })}
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
        {matched === '1' ? (
          <Checkbox
            label={t('report.attach')}
            hint={t('partners.reportAttachHint', { community })}
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

export default function PartnerReportRoute() {
  return (
    <RequireSession>
      <PartnerReportScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({ options: { gap: spacing.sm } });
