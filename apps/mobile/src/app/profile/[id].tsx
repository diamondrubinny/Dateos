import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { DecisionPanel, type DecisionResult } from '../../components/DecisionPanel';
import { Loading } from '../../components/Loading';
import { MatchCelebration } from '../../components/MatchCelebration';
import { ProfileCard } from '../../components/ProfileCard';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { useBlock, useProfile, useUnmatch } from '../../lib/queries';
import { radius, spacing, useColors } from '../../lib/theme';

type Confirm = 'block' | 'unmatch' | undefined;

function ProfileScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const { id, matchId } = useLocalSearchParams<{ id: string; matchId?: string }>();
  const profile = useProfile(id);
  const block = useBlock();
  const unmatch = useUnmatch();
  const [confirm, setConfirm] = useState<Confirm>();
  const [matched, setMatched] = useState(false);
  const [error, setError] = useState<string>();

  if (profile.isPending) return <Loading />;
  if (!profile.data) {
    return (
      <Screen back>
        <Banner tone="info" message={t('profileView.unavailable')} />
      </Screen>
    );
  }
  const p = profile.data;

  const onDecided = (result: DecisionResult) => {
    if (result.matched) setMatched(true);
    else router.back();
  };

  const run = async () => {
    try {
      if (confirm === 'block') await block.mutateAsync(p.id);
      if (confirm === 'unmatch' && matchId) await unmatch.mutateAsync(matchId);
      router.back();
    } catch {
      setError(t('common.genericError'));
    }
  };

  return (
    <Screen back>
      {error ? <Banner tone="error" message={error} /> : null}
      {matched ? <MatchCelebration name={p.displayName} onClose={() => router.back()} /> : null}
      {matchId ? (
        <>
          <Banner tone="info" message={t('matches.chatSoon')} />
          <ProfileCard profile={p} />
        </>
      ) : matched ? (
        <ProfileCard profile={p} />
      ) : (
        <DecisionPanel profile={p} onDecided={onDecided} />
      )}

      {confirm ? (
        <View
          style={[styles.confirm, { backgroundColor: colors.dangerSoft }]}
          accessibilityRole="alert"
        >
          <AppText variant="body">
            {confirm === 'block'
              ? t('profileView.blockConfirm', { name: p.displayName })
              : t('matches.unmatchConfirm', { name: p.displayName })}
          </AppText>
          <Button
            variant="danger"
            label={t('profileView.confirm')}
            loading={block.isPending || unmatch.isPending}
            onPress={() => void run()}
          />
          <Button
            variant="ghost"
            label={t('common.cancel')}
            onPress={() => setConfirm(undefined)}
          />
        </View>
      ) : (
        <View style={styles.safety}>
          {matchId ? (
            <Button
              variant="dangerGhost"
              label={t('matches.unmatch')}
              onPress={() => setConfirm('unmatch')}
            />
          ) : null}
          <Button
            variant="dangerGhost"
            label={t('profileView.block', { name: p.displayName })}
            onPress={() => setConfirm('block')}
          />
        </View>
      )}
    </Screen>
  );
}

export default function ProfileRoute() {
  return (
    <RequireSession>
      <ProfileScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  confirm: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
  safety: { gap: spacing.sm },
});
