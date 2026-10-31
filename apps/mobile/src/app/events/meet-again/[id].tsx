// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../components/AppText';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Loading } from '../../../components/Loading';
import { RequireSession } from '../../../components/RequireSession';
import { Screen } from '../../../components/Screen';
import { useEvent, useMeetAgain, useMeetAgainAction } from '../../../lib/event-queries';
import { radius, spacing, useColors } from '../../../lib/theme';

/**
 * "Meet again" after an in-person event (phase 71a): people who checked in and joined, and whom
 * I'd like to meet again. Only a mutual choice becomes a match; nobody learns a one-sided one.
 */
function MeetAgainScreen() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const state = useMeetAgain(id);
  const action = useMeetAgainAction(id);
  const [error, setError] = useState(false);

  if (state.isPending || event.isPending) return <Loading />;
  const title = t('meetAgain.title');
  if (!state.data) {
    return (
      <Screen back title={title}>
        <Banner tone="info" message={t('meetAgain.closed')} />
      </Screen>
    );
  }
  const { joined, closesAt, people } = state.data;
  const closes = new Date(closesAt).toLocaleString(i18n.language, {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  const act = (input: { join: true } | { userId: string; yes: boolean }) => {
    setError(false);
    action.mutate(input, { onError: () => setError(true) });
  };

  return (
    <Screen back title={title}>
      {event.data ? (
        <AppText variant="label" tone="muted" userContent>
          {event.data.title}
        </AppText>
      ) : null}
      <AppText variant="body">{t('meetAgain.intro')}</AppText>
      <AppText variant="caption" tone="muted">
        {t('meetAgain.closes', { when: closes })}
      </AppText>
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {!joined ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <AppText variant="body">{t('meetAgain.joinHint')}</AppText>
          <Button
            label={t('meetAgain.join')}
            loading={action.isPending}
            onPress={() => act({ join: true })}
          />
        </View>
      ) : people.length === 0 ? (
        <AppText variant="body" tone="muted" testID="meet-again-empty">
          {t('meetAgain.empty')}
        </AppText>
      ) : (
        <View role="list" style={styles.list}>
          {people.map((p) => (
            <View
              key={p.userId}
              role="listitem"
              testID="meet-again-person"
              style={[styles.card, { backgroundColor: colors.surface }]}
            >
              <AppText variant="heading" userContent>
                {p.displayName}
              </AppText>
              <Button
                variant="ghost"
                label={t('meetAgain.profile', { name: p.displayName })}
                onPress={() => router.push({ pathname: '/profile/[id]', params: { id: p.userId } })}
              />
              {p.matchId ? (
                <>
                  <AppText variant="label" tone="success" accessibilityLiveRegion="polite">
                    ✓ {t('meetAgain.mutual', { name: p.displayName })}
                  </AppText>
                  <Button
                    label={t('meetAgain.openChat')}
                    onPress={() =>
                      router.push({ pathname: '/chat/[id]', params: { id: p.matchId! } })
                    }
                  />
                </>
              ) : p.picked ? (
                <>
                  <AppText variant="label" tone="primary" accessibilityLiveRegion="polite">
                    {t('meetAgain.chosen')}
                  </AppText>
                  <Button
                    variant="ghost"
                    label={t('meetAgain.undo')}
                    hint={t('meetAgain.undoHint', { name: p.displayName })}
                    loading={action.isPending}
                    onPress={() => act({ userId: p.userId, yes: false })}
                  />
                </>
              ) : (
                <Button
                  variant="secondary"
                  label={t('meetAgain.choose', { name: p.displayName })}
                  loading={action.isPending}
                  onPress={() => act({ userId: p.userId, yes: true })}
                />
              )}
            </View>
          ))}
        </View>
      )}
      <Banner tone="info" message={t('meetAgain.privacy')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});

export default function MeetAgainRoute() {
  return (
    <RequireSession>
      <MeetAgainScreen />
    </RequireSession>
  );
}
