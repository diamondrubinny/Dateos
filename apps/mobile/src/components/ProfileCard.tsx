// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { cityName, type PublicProfile } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useKeyboardMode } from '../lib/focus-visible';
import { useLocale } from '../lib/locale';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { RemoteImage } from './RemoteImage';
import { AboutSection } from './AboutSection';
import { VoicePlayer } from './VoicePlayer';
import { useMe } from '../lib/queries';

export type LikeTarget = { itemType: 'photo' | 'prompt'; itemId: string; label: string };

interface ProfileCardProps {
  profile: PublicProfile;
  /** When set, photos and prompts get a "Like this" button. */
  onLikeItem?: (target: LikeTarget) => void;
}

function IconButton({
  label,
  glyph,
  onPress,
  style,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  style?: object;
}) {
  const colors = useColors();
  const keyboard = useKeyboardMode();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => [
        styles.iconButton,
        { backgroundColor: colors.background, borderColor: colors.border },
        keyboard &&
          (state as { focused?: boolean }).focused && {
            outlineColor: colors.focus,
            outlineWidth: 3,
            outlineStyle: 'solid' as const,
          },
        style,
      ]}
    >
      <AppText variant="heading" tone="primary" center importantForAccessibility="no">
        {glyph}
      </AppText>
    </Pressable>
  );
}

export function ProfileCard({ profile, onLikeItem }: ProfileCardProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const { direction, locale } = useLocale();
  const mine = useMe().data?.about.interests;
  const [index, setIndex] = useState(0);
  // Arrows point outward in both directions: "previous" sits at the start edge.
  const [prevGlyph, nextGlyph] = direction === 'rtl' ? ['›', '‹'] : ['‹', '›'];
  const photo = profile.photos[index];
  const total = profile.photos.length;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {photo ? (
        <View style={styles.photoWrap}>
          <RemoteImage
            path={photo.url}
            label={`${profile.displayName}, ${t('discover.photoOf', { n: index + 1, total })}`}
            style={styles.photo}
          />
          {total > 1 ? (
            <View style={styles.photoNav}>
              <IconButton
                label={t('discover.prevPhoto')}
                glyph={prevGlyph}
                onPress={() => setIndex((i) => (i - 1 + total) % total)}
              />
              <View style={[styles.counter, { backgroundColor: colors.background }]}>
                <AppText variant="caption" accessibilityLiveRegion="polite">
                  {t('discover.photoOf', { n: index + 1, total })}
                </AppText>
              </View>
              <IconButton
                label={t('discover.nextPhoto')}
                glyph={nextGlyph}
                onPress={() => setIndex((i) => (i + 1) % total)}
              />
            </View>
          ) : null}
          {onLikeItem ? (
            <IconButton
              label={t('discover.likePhotoLabel')}
              glyph="♥"
              onPress={() =>
                onLikeItem({
                  itemType: 'photo',
                  itemId: photo.id,
                  label: t('discover.likePhotoLabel'),
                })
              }
              style={styles.photoLike}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.body}>
        <AppText variant="title">
          {profile.displayName}, {profile.age}
        </AppText>
        <View style={styles.meta}>
          {profile.verified ? (
            <View
              style={[styles.verified, { backgroundColor: colors.primarySoft }]}
              accessible
              accessibilityLabel={t('badge.verifiedLabel')}
            >
              <AppText variant="label" tone="primary">
                ✓ {t('badge.verified')}
              </AppText>
            </View>
          ) : null}
          {profile.metInPerson ? (
            <View
              testID="met-badge"
              style={[styles.verified, { backgroundColor: colors.successSoft }]}
              accessible
              accessibilityLabel={t('badge.metLabel')}
            >
              <AppText variant="label" tone="success">
                🤝 {t('badge.met')}
              </AppText>
            </View>
          ) : null}
          <AppText variant="label" tone="primary">
            {t(`intention.${profile.intention}`)}
          </AppText>
          {profile.visiting ? (
            <AppText variant="caption" tone="muted" testID="visiting">
              ✈️ {t('travel.visiting', { city: cityName(profile.visiting.names, locale) })}
            </AppText>
          ) : profile.distance ? (
            <AppText variant="caption" tone="muted">
              {t(`distance.${profile.distance}`)}
            </AppText>
          ) : null}
        </View>

        {profile.reasons.length > 0 ? (
          <View style={styles.section}>
            <AppText variant="label">{t('discover.whyTitle')}</AppText>
            <View style={styles.chips} role="list">
              {profile.reasons.map((reason) => (
                <View
                  key={reason}
                  role="listitem"
                  style={[styles.chip, { backgroundColor: colors.primarySoft }]}
                >
                  <AppText variant="caption" tone="primary">
                    ✦ {t(`reason.${reason}`)}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {profile.bio ? (
          <View style={styles.section}>
            <AppText variant="label">
              {t('discover.aboutPerson', { name: profile.displayName })}
            </AppText>
            <AppText variant="body" userContent>
              {profile.bio}
            </AppText>
          </View>
        ) : null}

        {profile.about ? (
          <AboutSection about={profile.about} name={profile.displayName} mine={mine} />
        ) : null}

        {profile.friendTakes.length > 0 ? (
          <View
            style={styles.takes}
            testID="friend-takes"
            role="list"
            accessibilityLabel={t('takes.onProfile', { name: profile.displayName })}
          >
            <AppText variant="heading">
              {t('takes.onProfile', { name: profile.displayName })}
            </AppText>
            {profile.friendTakes.map((take, i) => (
              <View
                key={i}
                role="listitem"
                style={[styles.take, { backgroundColor: colors.primarySoft }]}
              >
                <AppText variant="body" userContent>
                  {t('ghosting.quote', { message: take.text })}
                </AppText>
                <AppText variant="caption" tone="muted" userContent>
                  {t('takes.byline', {
                    name: take.name,
                    relation: t(`takes.relations.${take.relation}`),
                  })}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        {profile.voicePrompt ? (
          <View
            style={[
              styles.prompt,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
            testID="profile-voice-prompt"
          >
            <View style={styles.promptText}>
              <AppText variant="caption" tone="muted">
                🎙️ {t(`prompt.${profile.voicePrompt.promptKey}`)}
              </AppText>
              <VoicePlayer
                path={`/v1/audio/${profile.voicePrompt.audioId}`}
                durationMs={profile.voicePrompt.durationMs}
                onPrimary={false}
              />
            </View>
          </View>
        ) : null}

        {profile.prompts.map((prompt) => {
          const question = t(`prompt.${prompt.promptKey}`);
          return (
            <View
              key={prompt.id}
              style={[
                styles.prompt,
                { backgroundColor: colors.background, borderColor: colors.border },
              ]}
            >
              <View style={styles.promptText}>
                <AppText variant="caption" tone="muted">
                  {question}
                </AppText>
                <AppText variant="heading" userContent>
                  {prompt.answer}
                </AppText>
              </View>
              {onLikeItem ? (
                <IconButton
                  label={t('discover.likeItemLabel', { item: question })}
                  glyph="♥"
                  onPress={() =>
                    onLikeItem({ itemType: 'prompt', itemId: prompt.id, label: question })
                  }
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  takes: { gap: spacing.sm },
  take: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  verified: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.lg },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  photoWrap: { width: '100%', aspectRatio: 4 / 5 },
  photo: { width: '100%', height: '100%' },
  photoNav: {
    position: 'absolute',
    top: spacing.sm,
    start: spacing.sm,
    end: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  counter: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  photoLike: { position: 'absolute', bottom: spacing.md, end: spacing.md },
  iconButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: spacing.lg, gap: spacing.md },
  meta: { gap: 2 },
  section: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  promptText: { flex: 1, gap: spacing.xs },
});
