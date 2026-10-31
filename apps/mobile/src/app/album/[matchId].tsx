// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { RemoteImage } from '../../components/RemoteImage';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { useSharedAlbum } from '../../lib/chat-queries';
import { spacing } from '../../lib/theme';

/**
 * Phase 66c: a match's private album, shared with me. Opening this screen starts the window; the
 * server stops serving the photos when it ends.
 */
function SharedAlbum() {
  const { t } = useTranslation();
  const { matchId, name = '' } = useLocalSearchParams<{ matchId: string; name?: string }>();
  const album = useSharedAlbum(matchId);
  if (album.isPending) return <Loading />;
  const data = album.data;
  const open = Boolean(data?.share?.open && data.photos.length > 0);
  return (
    <Screen back title={t('album.theirTitle', { name })}>
      {data?.share && open ? (
        <Banner tone="info" message={t(`album.window.${data.share.mode}`, { name })} />
      ) : (
        <AppText variant="body" testID="album-closed">
          {data?.share ? t('album.viewed', { name }) : t('album.notShared', { name })}
        </AppText>
      )}
      {open ? (
        <View style={styles.list} role="list" accessibilityLabel={t('album.theirTitle', { name })}>
          {data!.photos.map((p, i) => (
            <View key={p.id} role="listitem">
              <RemoteImage
                path={p.url}
                label={t('album.photoOf', { n: i + 1, total: data!.photos.length })}
                style={styles.photo}
              />
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

export default function SharedAlbumRoute() {
  return (
    <RequireSession>
      <SharedAlbum />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  photo: { width: '100%', aspectRatio: 4 / 5 },
});
