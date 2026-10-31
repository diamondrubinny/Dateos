// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_PHOTO_BYTES } from '@nexaheart/shared';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { LiveCheck } from '../components/LiveCheck';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { ApiRequestError } from '../lib/api';
import { useMe } from '../lib/queries';
import { useStartVerification, useSubmitSelfie, useVerification } from '../lib/safety-queries';
import { radius, spacing, useColors } from '../lib/theme';

function VerifyScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const state = useVerification();
  const start = useStartVerification();
  const submit = useSubmitSelfie();
  const [error, setError] = useState<string>();
  // Phase 69: a live check can verify too (the badge is on the profile).
  const verified = useMe().data?.verified ?? false;

  if (!state.data) return <Loading />;
  const { pose, processing } = state.data;
  const status = verified ? 'approved' : state.data.status;

  const begin = () => {
    setError(undefined);
    start.mutate(undefined, {
      onError: (e) => {
        if (e instanceof ApiRequestError && e.status === 409)
          return setError(t('verify.needPhoto'));
        if (e instanceof ApiRequestError && e.status === 429) return setError(t('verify.tooMany'));
        setError(t('common.genericError'));
      },
    });
  };

  const capture = async () => {
    setError(undefined);
    // Web browsers cannot open the camera through the picker everywhere: fall back to a file.
    const useCamera = Platform.OS !== 'web';
    if (useCamera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return setError(t('verify.cameraPermission'));
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.85,
      cameraType: ImagePicker.CameraType.front,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    };
    const result = useCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES)
      return setError(t('onboarding.photos.tooLarge'));
    submit.mutate(
      {
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        fileName: asset.fileName ?? null,
        file: asset.file ?? null,
      },
      {
        onError: (e) => {
          if (e instanceof ApiRequestError && e.status === 415)
            return setError(t('onboarding.photos.badType'));
          setError(t('common.genericError'));
        },
      },
    );
  };

  return (
    <Screen back title={t('verify.title')} subtitle={t('verify.intro')}>
      {error ? <Banner tone="error" message={error} /> : null}
      {status === 'approved' ? (
        <Banner tone="success" message={`✓ ${t('verify.approved')}`} />
      ) : null}
      {status === 'pending' ? (
        <Banner tone="info" message={processing ? t('verify.processing') : t('verify.pending')} />
      ) : null}
      {status === 'rejected' ? <Banner tone="info" message={t('verify.rejected')} /> : null}

      {/* Phase 69: the community's live check first, when it has a provider. */}
      {status === 'none' || status === 'rejected' ? <LiveCheck /> : null}
      {status === 'none' || status === 'rejected' ? (
        <Button
          variant="secondary"
          label={status === 'rejected' ? t('verify.retry') : t('verify.start')}
          loading={start.isPending}
          onPress={begin}
        />
      ) : null}

      {status === 'awaiting_selfie' && pose ? (
        <View style={[styles.pose, { backgroundColor: colors.primarySoft }]}>
          <AppText variant="heading" tone="primary" center>
            {t('verify.pose', { pose: t(`verify.poses.${pose}`) })}
          </AppText>
          <Button
            label={Platform.OS === 'web' ? t('verify.choose') : t('verify.take')}
            loading={submit.isPending}
            onPress={() => void capture()}
          />
        </View>
      ) : null}
    </Screen>
  );
}

export default function VerifyRoute() {
  return (
    <RequireSession>
      <VerifyScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  pose: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
});
