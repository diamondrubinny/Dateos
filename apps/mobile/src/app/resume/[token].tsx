// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { AboutSection } from '../../components/AboutSection';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { PoweredBy } from '../../components/PoweredBy';
import { RemoteImage } from '../../components/RemoteImage';
import { Screen } from '../../components/Screen';
import { useResumeCard } from '../../lib/resume-queries';
import { radius, spacing, useColors } from '../../lib/theme';

/**
 * Phase 68b: a member's matchmaking résumé, opened from a link they gave one person. No sign-in;
 * read-only; says whom it was shared with and until when (the photo carries the same watermark).
 */
export default function ResumePage() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const card = useResumeCard(token);
  if (card.isPending) return <Loading />;
  if (!card.data) {
    return (
      <Screen title={t('resume.pageTitle')}>
        <Banner tone="info" message={t('resume.invalid')} />
        <PoweredBy />
      </Screen>
    );
  }
  const c = card.data;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  const faithLine = c.faith
    ? [
        c.faith.faith ? t(`faith.faiths.${c.faith.faith}`) : null,
        c.faith.stream ? t(`faith.streams.${c.faith.stream}`) : null,
        ...Object.entries(c.faith.observance).map(
          ([q, a]) => `${t(`faith.questions.${q}`)}: ${t(`faith.answers.${a}`)}`,
        ),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <Screen title={t('resume.pageTitle')}>
      <View
        testID="resume-banner"
        style={[
          styles.banner,
          { backgroundColor: colors.primarySoft, borderColor: colors.primary },
        ]}
      >
        <AppText variant="label" tone="primary">
          {t('resume.banner', {
            community: c.community,
            label: c.label,
            shared: date(c.sharedAt),
            ends: date(c.expiresAt),
          })}
        </AppText>
        <AppText variant="caption">{t('resume.bannerHint')}</AppText>
      </View>
      <View testID="resume-card" style={[styles.card, { borderColor: colors.border }]}>
        {c.photoUrl ? (
          <RemoteImage
            path={c.photoUrl}
            label={t('resume.photoOf', { name: c.displayName })}
            style={styles.photo}
          />
        ) : null}
        <AppText variant="title" userContent>
          {c.displayName}, {c.age}
        </AppText>
        <AppText variant="label" tone="primary">
          {t(`intention.${c.intention}`)}
        </AppText>
        {faithLine ? <AppText variant="body">{faithLine}</AppText> : null}
        {c.bio ? (
          <AppText variant="body" userContent>
            {c.bio}
          </AppText>
        ) : null}
        {c.about ? <AboutSection about={c.about} name={c.displayName} /> : null}
        {c.prompts.map((p) => (
          <View key={p.promptKey} style={[styles.prompt, { backgroundColor: colors.surface }]}>
            <AppText variant="caption" tone="muted">
              {t(`prompt.${p.promptKey}`)}
            </AppText>
            <AppText variant="body" userContent>
              {p.answer}
            </AppText>
          </View>
        ))}
      </View>
      {Platform.OS === 'web' ? (
        <Button variant="secondary" label={t('resume.print')} onPress={() => window.print()} />
      ) : null}
      <PoweredBy />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md },
  prompt: { borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
});
