// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { useChaperoning, useStepDown } from '../../lib/chaperone-queries';
import { radius, spacing, useColors } from '../../lib/theme';

/** Phase 68d: the members I chaperone and their dating chats (read-only). */
function Chaperoning() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const data = useChaperoning();
  const stepDown = useStepDown();
  if (!data.data) return <Loading />;
  return (
    <Screen back title={t('chaperone.iChaperone')}>
      <AppText variant="body">{t('chaperone.listIntro')}</AppText>
      {data.data.members.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('chaperone.none')}
        </AppText>
      ) : null}
      {data.data.members.map((m) => (
        <View
          key={m.userId}
          testID="chaperoned-member"
          style={[styles.card, { borderColor: colors.border }]}
        >
          <AppText variant="heading" userContent>
            {m.displayName}
          </AppText>
          <AppText variant="caption" tone="muted">
            {t('chaperone.since', {
              date: new Date(m.since).toLocaleDateString(i18n.language, {
                day: 'numeric',
                month: 'long',
              }),
            })}
          </AppText>
          {m.chats.length === 0 ? (
            <AppText variant="body" tone="muted">
              {t('chaperone.noChats')}
            </AppText>
          ) : (
            m.chats.map((c) => (
              <Button
                key={c.matchId}
                variant="secondary"
                label={t('chaperone.openChat', { name: m.displayName, other: c.otherName })}
                onPress={() => router.push(`/chaperoning/${m.userId}/${c.matchId}`)}
              />
            ))
          )}
          <Button
            variant="dangerGhost"
            label={t('chaperone.stepDown', { name: m.displayName })}
            onPress={() => stepDown.mutate(m.userId)}
          />
        </View>
      ))}
    </Screen>
  );
}

export default function ChaperoningRoute() {
  return (
    <RequireSession>
      <Chaperoning />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
});
