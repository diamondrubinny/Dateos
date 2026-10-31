// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_ALBUM_PHOTOS } from '@nexaheart/shared';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RemoteImage } from '../components/RemoteImage';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { useAddAlbumPhoto, useMyAlbum, useRemoveAlbumPhoto } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

/**
 * Phase 66c: my private album, up to 6 photos never shown on the profile; shared from a chat with
 * one match at a time.
 */
function MyAlbum() {
  const { t } = useTranslation();
  const colors = useColors();
  const album = useMyAlbum();
  const add = useAddAlbumPhoto();
  const remove = useRemoveAlbumPhoto();
  const [error, setError] = useState<string>();
  if (!album.data) return <Loading />;
  const photos = album.data.photos;

  const pick = async () => {
    setError(undefined);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    add.mutate(
      {
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        fileName: asset.fileName ?? null,
        file: asset.file ?? null,
      },
      { onError: () => setError(t('common.genericError')) },
    );
  };

  return (
    <Screen back title={t('album.title')}>
      <AppText variant="body">{t('album.intro')}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {photos.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('album.empty')}
        </AppText>
      ) : null}
      <View style={styles.grid} role="list" accessibilityLabel={t('album.title')}>
        {photos.map((p, i) => (
          <View
            key={p.id}
            role="listitem"
            style={[styles.item, { borderColor: colors.border }]}
            testID="album-photo"
          >
            {p.url ? (
              <RemoteImage
                path={p.url}
                label={t('album.photoOf', { n: i + 1, total: photos.length })}
                style={styles.photo}
              />
            ) : (
              <View style={[styles.photo, styles.pending, { backgroundColor: colors.surface }]}>
                <AppText variant="caption" tone="muted" center>
                  {t('album.checking')}
                </AppText>
              </View>
            )}
            <Button
              variant="dangerGhost"
              label={t('album.remove', { n: i + 1 })}
              onPress={() =>
                remove.mutate(p.id, { onError: () => setError(t('common.genericError')) })
              }
            />
          </View>
        ))}
      </View>
      {photos.length < MAX_ALBUM_PHOTOS ? (
        <Button label={t('album.add')} loading={add.isPending} onPress={() => void pick()} />
      ) : (
        <AppText variant="caption" tone="muted">
          {t('album.full', { count: MAX_ALBUM_PHOTOS })}
        </AppText>
      )}
    </Screen>
  );
}

export default function MyAlbumRoute() {
  return (
    <RequireSession>
      <MyAlbum />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  item: { width: 150, borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 1 },
  pending: { alignItems: 'center', justifyContent: 'center', padding: spacing.sm },
});
