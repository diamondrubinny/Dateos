// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  ACCESSIBILITY_CONSENT_VERSION,
  accessNeeds,
  type AccessNeed,
  type AccessNeeds,
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
import { useMe, useSetAccessNeeds, useSetConsents } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

/**
 * Accessibility needs (phase 25): optional, with their own consent. Private by default (only this
 * member's app uses them); shown on the profile only when turned on.
 */
function AccessNeedsEditor() {
  const { t } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const save = useSetAccessNeeds();
  const consents = useSetConsents();
  const [value, setValue] = useState<AccessNeeds>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (value === undefined && me.data) setValue(me.data.accessNeeds);
  }, [me.data, value]);
  if (!me.data || !value) return <Loading />;

  const allowed = me.data.consents.accessibility === true;
  const submit = async () => {
    setError(undefined);
    setSaved(false);
    try {
      await save.mutateAsync(value);
      setSaved(true);
      if (router.canGoBack()) router.back();
    } catch {
      setError(t('common.genericError'));
    }
  };

  return (
    <Screen
      back
      title={t('access.title')}
      footer={
        allowed ? (
          <Button label={t('common.save')} loading={save.isPending} onPress={() => void submit()} />
        ) : undefined
      }
    >
      <AppText variant="body" tone="muted">
        {t('access.intro')}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {saved ? <Banner tone="success" message={t('access.saved')} /> : null}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Checkbox
          label={t('access.consent')}
          hint={t('access.consentHint')}
          checked={allowed}
          onChange={(granted) =>
            consents.mutate(
              [{ kind: 'accessibility', granted, version: ACCESSIBILITY_CONSENT_VERSION }],
              {
                // Withdrawing deletes the needs on the server; mirror that here.
                onSuccess: () => !granted && setValue({ needs: [], show: false }),
                onError: () => setError(t('common.genericError')),
              },
            )
          }
        />
      </View>
      {allowed ? (
        <>
          <ChoiceGroup<AccessNeed>
            label={t('access.needsLabel')}
            multiple
            stacked
            options={accessNeeds.map((need) => ({ value: need, label: t(`access.needs.${need}`) }))}
            selected={value.needs}
            onChange={(needs) => setValue({ needs, show: needs.length > 0 && value.show })}
          />
          <AppText variant="heading">{t('access.howTitle')}</AppText>
          <AppText variant="body">{t('access.howPrivate')}</AppText>
          <Checkbox
            label={t('access.show')}
            hint={t('access.showHint')}
            checked={value.show}
            onChange={(show) => setValue({ ...value, show: value.needs.length > 0 && show })}
          />
          <AppText variant="caption" tone="muted">
            {t('access.never')}
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

export default function AccessNeedsScreen() {
  return (
    <RequireSession>
      <AccessNeedsEditor />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
});
