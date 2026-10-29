// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { MAX_PHOTO_DESCRIPTION, type Photo } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useDescribePhoto } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { TextField } from './TextField';

function PhotoDescription({ photo, n }: { photo: Photo; n: number }) {
  const { t } = useTranslation();
  const save = useDescribePhoto();
  const [text, setText] = useState(photo.description ?? '');
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string }>();
  const changed = text.trim() !== (photo.description ?? '');
  return (
    <View style={styles.item} testID={`photo-description-${n}`}>
      <TextField
        label={t('photoText.label', { n })}
        hint={t('photoText.hint')}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setNote(undefined);
        }}
        maxLength={MAX_PHOTO_DESCRIPTION}
        multiline
      />
      {note ? <Banner tone={note.tone} message={note.text} /> : null}
      <Button
        variant="secondary"
        label={t('photoText.save', { n })}
        disabled={!changed}
        loading={save.isPending}
        onPress={() =>
          save.mutate(
            { photoId: photo.id, description: text },
            {
              onSuccess: () => setNote({ tone: 'info', text: t('photoText.saved') }),
              onError: (e) =>
                setNote({
                  tone: 'error',
                  text:
                    e instanceof ApiRequestError && e.status === 400
                      ? t('photoText.rephrase')
                      : t('common.genericError'),
                }),
            },
          )
        }
      />
    </View>
  );
}

/**
 * Describe your photos (phase 40): a sentence for each photo, read by screen readers to people
 * who can't see it. Optional; only photos that passed the checks can be described.
 */
export function PhotoDescriptions({ photos }: { photos: Photo[] }) {
  const { t } = useTranslation();
  const colors = useColors();
  const clean = photos.filter((p) => p.status === 'clean');
  if (clean.length === 0) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="photo-descriptions">
      <AppText variant="heading">{t('photoText.title')}</AppText>
      <AppText variant="body" tone="muted">
        {t('photoText.intro')}
      </AppText>
      {clean.map((photo) => (
        <PhotoDescription key={photo.id} photo={photo} n={photos.indexOf(photo) + 1} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  item: { gap: spacing.sm },
});
