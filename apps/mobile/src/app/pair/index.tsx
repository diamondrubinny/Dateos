// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { PairInvite, PairMemberTile } from '../../components/DoubleDeck';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { useLeavePair, useMyPair } from '../../lib/friend-queries';
import { spacing } from '../../lib/theme';

/** My pair for double dates (phase 22): who it's with, and ending it (with a confirmation). */
function PairScreen() {
  const { t } = useTranslation();
  const pair = useMyPair();
  const leave = useLeavePair();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  if (pair.isPending) return <Loading />;
  return (
    <Screen back title={t('pair.manageTitle')}>
      {error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {!pair.data ? (
        <PairInvite />
      ) : (
        <View style={styles.wrap}>
          <AppText variant="body">
            {t('pair.withFriend', { name: pair.data.friend.displayName })}
          </AppText>
          <View style={styles.tile}>
            <PairMemberTile member={pair.data.friend} />
          </View>
          {confirming ? (
            <>
              <Banner tone="info" message={t('pair.leaveConfirm')} />
              <Button
                variant="danger"
                label={t('pair.leaveYes')}
                loading={leave.isPending}
                onPress={() =>
                  leave.mutate(undefined, {
                    onSuccess: () => router.replace('/discover'),
                    onError: () => setError(true),
                  })
                }
              />
              <Button
                variant="ghost"
                label={t('common.cancel')}
                onPress={() => setConfirming(false)}
              />
            </>
          ) : (
            <Button
              variant="dangerGhost"
              label={t('pair.leave')}
              onPress={() => setConfirming(true)}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

export default function PairRoute() {
  return (
    <RequireSession>
      <PairScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  tile: { maxWidth: 220 },
});
