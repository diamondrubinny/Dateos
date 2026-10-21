import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { Screen } from '../../components/Screen';
import { mediaUrl } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { routeFor } from '../../lib/routes';
import { radius, spacing, useColors } from '../../lib/theme';
import { useSessionCookie } from '../../lib/use-cookie';

function ProfileContent() {
  const { t } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const cookie = useSessionCookie();
  if (!me.data) return <Loading />;
  if (!me.data.onboarding.complete) return <Redirect href={routeFor(me.data)} />;

  const { profile, photos, prompts } = me.data;
  const cover = photos.find((p) => p.url);
  return (
    <Screen title={t('home.greeting', { name: profile?.displayName ?? '' })}>
      <View style={[styles.ready, { backgroundColor: colors.primarySoft }]}>
        <AppText variant="heading" tone="primary">
          {t('home.readyTitle')}
        </AppText>
        <AppText variant="body">{t('home.readyBody')}</AppText>
      </View>

      <AppText variant="heading">{t('home.profileTitle')}</AppText>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {cover?.url ? (
          <Image
            source={{
              uri: mediaUrl(cover.url),
              ...(Platform.OS !== 'web' && cookie ? { headers: { cookie } } : {}),
            }}
            style={styles.cover}
            contentFit="cover"
            accessibilityLabel={profile?.displayName ?? ''}
          />
        ) : null}
        <View style={styles.cardBody}>
          <AppText variant="title">
            {profile?.displayName}, {profile?.age}
          </AppText>
          {profile ? (
            <AppText variant="label" tone="primary">
              {t(`intention.${profile.intention}`)}
            </AppText>
          ) : null}
          {profile?.bio ? (
            <AppText variant="body" userContent>
              {profile.bio}
            </AppText>
          ) : null}
          {prompts.map((p) => (
            <View key={p.promptKey} style={[styles.prompt, { backgroundColor: colors.background }]}>
              <AppText variant="caption" tone="muted">
                {t(`prompt.${p.promptKey}`)}
              </AppText>
              <AppText variant="heading" userContent>
                {p.answer}
              </AppText>
            </View>
          ))}
        </View>
      </View>
      <Button
        variant="secondary"
        label={t('home.settings')}
        onPress={() => router.push('/settings')}
      />
    </Screen>
  );
}

export default function ProfileTab() {
  return <ProfileContent />;
}

const styles = StyleSheet.create({
  ready: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  cover: { width: '100%', aspectRatio: 4 / 5 },
  cardBody: { padding: spacing.lg, gap: spacing.sm },
  prompt: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
});
