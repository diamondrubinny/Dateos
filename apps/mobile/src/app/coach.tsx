import type { CoachTipId } from '@dateos/shared';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { useCoach } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

const actions: Record<CoachTipId, Href> = {
  add_photos: '/onboarding/photos?edit=1',
  bio_missing: '/edit-bio',
  bio_short: '/edit-bio',
  bio_generic: '/edit-bio',
  add_prompts: '/onboarding/prompts?edit=1',
  prompt_short: '/onboarding/prompts?edit=1',
  verify: '/verify',
};

/** Profile tips: explainable rules, computed on this community's server. */
function Coach() {
  const { t } = useTranslation();
  const colors = useColors();
  const coach = useCoach();
  if (coach.isPending) return <Loading />;
  if (!coach.data) return <Banner tone="error" message={t('common.genericError')} />;
  const tips = coach.data.tips;
  return (
    <Screen back title={t('coach.title')} subtitle={t('coach.intro')}>
      {tips.length === 0 ? <Banner tone="success" message={t('coach.allGood')} /> : null}
      <View role="list" style={styles.list}>
        {tips.map(({ id }) => (
          <View
            key={id}
            role="listitem"
            style={[styles.tip, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <AppText variant="heading">{t(`coach.tips.${id}.title`)}</AppText>
            <AppText variant="body">{t(`coach.tips.${id}.body`)}</AppText>
            <Button
              variant="secondary"
              label={t(`coach.tips.${id}.action`)}
              onPress={() => router.push(actions[id])}
            />
          </View>
        ))}
      </View>
      <AppText variant="caption" tone="muted">
        {t('coach.howItWorks')}
      </AppText>
    </Screen>
  );
}

export default function CoachRoute() {
  return (
    <RequireSession>
      <Coach />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  tip: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm },
});
