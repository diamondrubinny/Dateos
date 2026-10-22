// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Photo } from '@nexaheart/shared';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { mediaUrl } from '../lib/api';
import { useKeyboardMode } from '../lib/focus-visible';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';

interface PhotoTileProps {
  index: number;
  photo?: Photo;
  cookie?: string;
  onAdd?: () => void;
  onRemove?: (photo: Photo) => void;
}

export function PhotoTile({ index, photo, cookie, onAdd, onRemove }: PhotoTileProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const keyboard = useKeyboardMode();
  const n = index + 1;

  if (!photo) {
    return (
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={t('onboarding.photos.addSlot', { n })}
        style={(state) => [
          styles.tile,
          styles.empty,
          { borderColor: colors.border, backgroundColor: colors.surface },
          keyboard &&
            (state as { focused?: boolean }).focused && {
              outlineColor: colors.focus,
              outlineWidth: 3,
              outlineStyle: 'solid' as const,
            },
        ]}
      >
        <AppText variant="title" tone="primary" center>
          +
        </AppText>
      </Pressable>
    );
  }

  const pending = photo.status === 'quarantine' || photo.status === 'processing';
  return (
    <View
      style={[styles.tile, { backgroundColor: colors.surface }]}
      accessibilityLabel={t('onboarding.photos.photoLabel', { n })}
    >
      {photo.url ? (
        <Image
          source={{
            uri: mediaUrl(photo.url),
            // Native image loading does not share the web cookie jar, so the session is passed explicitly.
            ...(Platform.OS !== 'web' && cookie ? { headers: { cookie } } : {}),
          }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityIgnoresInvertColors
          accessibilityLabel={t('onboarding.photos.photoLabel', { n })}
        />
      ) : (
        <View style={styles.status}>
          {pending ? <ActivityIndicator color={colors.primary} /> : null}
          <AppText variant="caption" tone={pending ? 'muted' : 'danger'} center>
            {pending ? t('onboarding.photos.checking') : t('onboarding.photos.rejected')}
          </AppText>
        </View>
      )}
      {onRemove ? (
        <Pressable
          onPress={() => onRemove(photo)}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.photos.remove', { n })}
          style={[styles.remove, { backgroundColor: colors.background }]}
          hitSlop={8}
        >
          <AppText variant="label" tone="danger">
            ✕
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: '31%', aspectRatio: 3 / 4, borderRadius: radius.md, overflow: 'hidden' },
  empty: { borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  remove: {
    position: 'absolute',
    top: spacing.xs,
    end: spacing.xs,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
