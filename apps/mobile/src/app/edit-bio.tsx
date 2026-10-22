import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { useLocale } from '../lib/locale';
import { coachKey, useBioIdeas, useCoach, useMe, useUpdateProfile } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

function EditBio() {
  const { t } = useTranslation();
  const colors = useColors();
  const { locale } = useLocale();
  const client = useQueryClient();
  const me = useMe();
  const coach = useCoach();
  const ideas = useBioIdeas();
  const update = useUpdateProfile();
  const [bio, setBio] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (bio === undefined && me.data?.profile) setBio(me.data.profile.bio ?? '');
  }, [me.data, bio]);
  if (!me.data || bio === undefined) return <Loading />;

  const save = async () => {
    setError(undefined);
    try {
      await update.mutateAsync({ bio: bio.trim() });
      await client.invalidateQueries({ queryKey: coachKey });
      router.back();
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 400
          ? t('editBio.invalid')
          : t('common.genericError'),
      );
    }
  };

  const askIdeas = () =>
    ideas.mutate(locale, {
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.status === 429
            ? t('editBio.tooMany')
            : t('common.genericError'),
        ),
    });

  const availability = coach.data?.bioIdeas;
  return (
    <Screen
      back
      title={t('editBio.title')}
      footer={
        <Button label={t('editBio.save')} loading={update.isPending} onPress={() => void save()} />
      }
    >
      {error ? <Banner tone="error" message={error} /> : null}
      <TextField
        label={t('editBio.label')}
        hint={t('editBio.hint')}
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={500}
      />

      {availability === 'available' ? (
        <View style={[styles.card, { backgroundColor: colors.primarySoft }]}>
          <AppText variant="heading" tone="primary">
            ✨ {t('editBio.ideasTitle')}
          </AppText>
          <AppText variant="caption">{t('editBio.ideasHint')}</AppText>
          <Button
            variant="secondary"
            label={t('editBio.getIdeas')}
            loading={ideas.isPending}
            onPress={askIdeas}
          />
          {ideas.data && ideas.data.ideas.length === 0 ? (
            <AppText variant="body" tone="muted" accessibilityLiveRegion="polite">
              {t('editBio.noIdeas')}
            </AppText>
          ) : null}
          {ideas.data?.ideas.map((idea, i) => (
            <View
              key={idea}
              style={[
                styles.idea,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
            >
              <AppText variant="caption" tone="muted">
                {t('editBio.ideaLabel', { n: i + 1 })}
              </AppText>
              <AppText variant="body" userContent>
                {idea}
              </AppText>
              <Button
                variant="ghost"
                label={t('editBio.useIdea', { n: i + 1 })}
                onPress={() => setBio(idea)}
              />
            </View>
          ))}
        </View>
      ) : availability === 'needs_consent' ? (
        <AppText variant="caption" tone="muted">
          {t('editBio.needsConsent')}
        </AppText>
      ) : null}
    </Screen>
  );
}

export default function EditBioRoute() {
  return (
    <RequireSession>
      <EditBio />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm },
  idea: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs },
});
