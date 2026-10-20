import { MAX_PHOTO_BYTES, MAX_PHOTOS, type Photo } from '@dateos/shared';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { PhotoTile } from '../../components/PhotoTile';
import { Screen } from '../../components/Screen';
import { ApiRequestError } from '../../lib/api';
import { useDeletePhoto, useMe, useUploadPhoto } from '../../lib/queries';
import { ONBOARDING_TOTAL } from '../../lib/routes';
import { spacing } from '../../lib/theme';
import { useSessionCookie } from '../../lib/use-cookie';

export default function PhotosStep() {
  const { t } = useTranslation();
  const me = useMe();
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const cookie = useSessionCookie();
  const [error, setError] = useState<string>();

  if (!me.data) return <Loading />;
  const photos = me.data.photos;
  const clean = photos.filter((p) => p.status === 'clean');

  const pick = async () => {
    setError(undefined);
    if (photos.length >= MAX_PHOTOS) return setError(t('onboarding.photos.limit'));
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setError(t('onboarding.photos.permission'));
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsMultipleSelection: false,
      // Ask iOS to hand over JPEG instead of HEIC, which the server does not accept.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES)
      return setError(t('onboarding.photos.tooLarge'));
    try {
      await upload.mutateAsync({
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        fileName: asset.fileName ?? null,
        file: asset.file ?? null,
      });
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 415)
        return setError(t('onboarding.photos.badType'));
      if (e instanceof ApiRequestError && e.status === 413)
        return setError(t('onboarding.photos.tooLarge'));
      if (e instanceof ApiRequestError && e.status === 409)
        return setError(t('onboarding.photos.limit'));
      setError(t('common.genericError'));
    }
  };

  const onRemove = (photo: Photo) => {
    remove.mutate(photo.id, { onError: () => setError(t('common.genericError')) });
  };

  const next = () => {
    if (clean.length === 0) return setError(t('onboarding.photos.needOne'));
    router.replace('/onboarding/prompts');
  };

  return (
    <Screen
      title={t('onboarding.photos.title')}
      subtitle={t('onboarding.photos.subtitle')}
      step={{ current: 3, total: ONBOARDING_TOTAL }}
      footer={<Button label={t('common.continue')} onPress={next} disabled={upload.isPending} />}
    >
      {error ? <Banner tone="error" message={error} /> : null}
      <View style={styles.grid}>
        {Array.from({ length: MAX_PHOTOS }, (_, index) => {
          const photo = photos[index];
          return (
            <PhotoTile
              key={photo?.id ?? `slot-${index}`}
              index={index}
              {...(photo ? { photo, onRemove } : { onAdd: () => void pick() })}
              {...(cookie ? { cookie } : {})}
            />
          );
        })}
      </View>
      <Button
        variant="secondary"
        label={t('onboarding.photos.add')}
        loading={upload.isPending}
        onPress={() => void pick()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-start' },
});
