// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  MAX_RESUME_LINKS,
  RESUME_LABEL_MAX,
  resumeDays,
  resumeSections,
  type ResumeSection,
} from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { shareLink } from '../../lib/friend-queries';
import {
  resumeUrl,
  useCreateResumeLink,
  useEndResumeLink,
  useResumeLinks,
} from '../../lib/resume-queries';
import { radius, spacing, useColors } from '../../lib/theme';

type Days = (typeof resumeDays)[number];

/**
 * Phase 68b: a "matchmaking résumé" for one person (a parent, a matchmaker), by a link that ends
 * by itself and can be ended sooner. The member chooses what it shows.
 */
function Resume() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const links = useResumeLinks();
  const create = useCreateResumeLink();
  const end = useEndResumeLink();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<Days>(3);
  const [sections, setSections] = useState<ResumeSection[]>(['photo', 'about']);
  const [made, setMade] = useState<{ url: string; status: 'shared' | 'copied' | 'shown' }>();
  const [error, setError] = useState<string>();
  if (!links.data) return <Loading />;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' });
  const full = links.data.length >= MAX_RESUME_LINKS;

  const submit = () => {
    if (!label.trim()) return;
    setError(undefined);
    setMade(undefined);
    create.mutate(
      { label: label.trim(), days, sections },
      {
        onSuccess: async (link) => {
          const url = resumeUrl(link.token);
          setLabel('');
          setMade({ url, status: await shareLink(url, t('resume.shareMessage')) });
        },
        onError: () => setError(t('common.genericError')),
      },
    );
  };

  return (
    <Screen back title={t('resume.title')}>
      <AppText variant="body">{t('resume.intro')}</AppText>
      <Banner tone="info" message={t('resume.warning')} />
      {error ? <Banner tone="error" message={error} /> : null}
      {made ? (
        <View testID="resume-made" style={[styles.made, { backgroundColor: colors.successSoft }]}>
          <AppText variant="label" tone="success">
            {t(`resume.made.${made.status}`)}
          </AppText>
          <AppText variant="caption" selectable>
            {made.url}
          </AppText>
        </View>
      ) : null}

      {full ? (
        <AppText variant="body" tone="muted">
          {t('resume.full', { count: MAX_RESUME_LINKS })}
        </AppText>
      ) : (
        <View style={[styles.form, { borderColor: colors.border }]}>
          <AppText variant="heading">{t('resume.newTitle')}</AppText>
          <TextField
            label={t('resume.label')}
            hint={t('resume.labelHint')}
            value={label}
            onChangeText={setLabel}
            maxLength={RESUME_LABEL_MAX}
          />
          <ChoiceGroup<`${Days}`>
            label={t('resume.days')}
            options={resumeDays.map((d) => ({ value: `${d}`, label: t(`resume.dayOptions.${d}`) }))}
            selected={[`${days}`]}
            onChange={([d]) => d && setDays(Number(d) as Days)}
          />
          <ChoiceGroup<ResumeSection>
            label={t('resume.sections')}
            multiple
            stacked
            options={resumeSections.map((s) => ({ value: s, label: t(`resume.section.${s}`) }))}
            selected={sections}
            onChange={setSections}
          />
          <AppText variant="caption" tone="muted">
            {t('resume.always')}
          </AppText>
          <Button
            label={t('resume.create')}
            loading={create.isPending}
            disabled={!label.trim()}
            onPress={submit}
          />
        </View>
      )}

      <AppText variant="heading">{t('resume.activeTitle')}</AppText>
      {links.data.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('resume.none')}
        </AppText>
      ) : (
        <View style={styles.list} role="list" accessibilityLabel={t('resume.activeTitle')}>
          {links.data.map((l) => (
            <View
              key={l.id}
              role="listitem"
              testID="resume-link"
              style={[styles.item, { borderColor: colors.border }]}
            >
              <AppText variant="label" userContent>
                {l.label}
              </AppText>
              <AppText variant="caption" tone="muted">
                {t('resume.until', { date: date(l.expiresAt) })} ·{' '}
                {t('resume.views', { count: l.views })}
              </AppText>
              <Button
                variant="dangerGhost"
                label={t('resume.end', { label: l.label })}
                onPress={() =>
                  end.mutate(l.id, { onError: () => setError(t('common.genericError')) })
                }
              />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

export default function ResumeRoute() {
  return (
    <RequireSession>
      <Resume />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  form: { borderTopWidth: 1, paddingTop: spacing.md, gap: spacing.sm },
  made: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  list: { gap: spacing.sm },
  item: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
});
