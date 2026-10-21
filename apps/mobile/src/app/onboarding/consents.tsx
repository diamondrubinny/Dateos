import { SENSITIVE_CONSENT_VERSION } from '@dateos/shared';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Choice';
import { Screen } from '../../components/Screen';
import { useInstance, useSetConsents } from '../../lib/queries';
import { ONBOARDING_TOTAL } from '../../lib/routes';
import { spacing, useColors } from '../../lib/theme';

/** Version of optional, in-app consent texts (not legal documents). */
const OPTIONAL_CONSENT_VERSION = '1';

export default function ConsentsStep() {
  const { t } = useTranslation();
  const colors = useColors();
  const instance = useInstance();
  const save = useSetConsents();
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  // Optional consents are never pre-selected.
  const [aiCloud, setAiCloud] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    if (!terms || !privacy || !sensitive) return setError(t('onboarding.consents.mustAccept'));
    if (!instance.data) return setError(t('common.genericError'));
    setError(undefined);
    try {
      await save.mutateAsync([
        { kind: 'terms', granted: true, version: instance.data.legal.termsVersion },
        { kind: 'privacy', granted: true, version: instance.data.legal.privacyVersion },
        { kind: 'sensitive', granted: true, version: SENSITIVE_CONSENT_VERSION },
        { kind: 'ai_cloud', granted: aiCloud, version: OPTIONAL_CONSENT_VERSION },
        { kind: 'analytics', granted: analytics, version: OPTIONAL_CONSENT_VERSION },
      ]);
      router.replace('/'); // next missing step (the profile, or back to where they were)
    } catch {
      setError(t('common.genericError'));
    }
  };

  const required = t('onboarding.consents.required');
  return (
    <Screen
      title={t('onboarding.consents.title')}
      subtitle={t('onboarding.consents.subtitle')}
      step={{ current: 1, total: ONBOARDING_TOTAL }}
      footer={
        <Button
          label={t('common.continue')}
          loading={save.isPending}
          onPress={() => void submit()}
        />
      }
    >
      {error ? <Banner tone="error" message={error} /> : null}
      <View style={styles.group}>
        <Checkbox
          label={t('onboarding.consents.terms')}
          badge={required}
          checked={terms}
          onChange={setTerms}
        />
        <Link href="/terms" style={[styles.link, { color: colors.primary }]}>
          {t('onboarding.consents.readTerms')}
        </Link>
      </View>
      <View style={styles.group}>
        <Checkbox
          label={t('onboarding.consents.privacy')}
          badge={required}
          checked={privacy}
          onChange={setPrivacy}
        />
        <Link href="/privacy" style={[styles.link, { color: colors.primary }]}>
          {t('onboarding.consents.readPrivacy')}
        </Link>
      </View>
      <Checkbox
        label={t('onboarding.consents.sensitive')}
        hint={t('onboarding.consents.sensitiveHint')}
        badge={required}
        checked={sensitive}
        onChange={setSensitive}
      />
      <Checkbox
        label={t('onboarding.consents.aiCloud')}
        hint={t('onboarding.consents.aiCloudHint')}
        badge={t('common.optional')}
        checked={aiCloud}
        onChange={setAiCloud}
      />
      <Checkbox
        label={t('onboarding.consents.analytics')}
        hint={t('onboarding.consents.analyticsHint')}
        badge={t('common.optional')}
        checked={analytics}
        onChange={setAnalytics}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs },
  link: {
    fontSize: 15,
    fontWeight: '600',
    textDecorationLine: 'underline',
    paddingVertical: spacing.xs,
  },
});
