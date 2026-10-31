// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { cityName, type PublicProfile } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useKeyboardMode } from '../lib/focus-visible';
import { useLocale } from '../lib/locale';
import { MIN_TOUCH, radius, spacing, focusRing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { RemoteImage } from './RemoteImage';
import { AboutSection } from './AboutSection';
import { VoicePlayer } from './VoicePlayer';
import { VoiceTranscript } from './VoiceTranscript';
import { useInstance, useMe } from '../lib/queries';

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
        keyboard && (state as { focused?: boolean }).focused && focusRing(colors),
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
  const afterMatch = useInstance().data?.community.photosAfterMatch ?? false;
  const [index, setIndex] = useState(0);
  // Arrows point outward in both directions: "previous" sits at the start edge.
  const [prevGlyph, nextGlyph] = direction === 'rtl' ? ['›', '‹'] : ['‹', '›'];
  const photo = profile.photos[index];
  const faith = profile.faith;
  const faithLine = faith
    ? [
        faith.faith ? t(`faith.faiths.${faith.faith}`) : null,
        faith.stream ? t(`faith.streams.${faith.stream}`) : null,
        ...Object.entries(faith.observance).map(
          ([q, a]) => `${t(`faith.questions.${q}`)}: ${t(`faith.answers.${a}`)}`,
        ),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const identity = profile.identity;
  const identityLine = identity
    ? [
        identity.genderCustom ??
          (identity.genderIdentity ? t(`identity.options.${identity.genderIdentity}`) : null),
        identity.pronouns ? t(`identity.forms.${identity.pronouns}`) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const total = profile.photos.length;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {photo ? (
        <View style={styles.photoWrap}>
          <RemoteImage
            path={photo.url}
            // The member's own description (phase 40), when there is one; a blurred photo
            // (phase 66a) says why instead.
            label={[
              `${profile.displayName}, ${t('discover.photoOf', { n: index + 1, total })}`,
              photo.blurred ? t('blur.hiddenLabel') : photo.description,
            ]
              .filter(Boolean)
              .join('. ')}
            style={styles.photo}
            // The server already sends a tiny blurred copy; this only smooths it when scaled up.
            {...(photo.blurred ? { blurRadius: 20 } : {})}
          />
          {photo.blurred ? (
            <View
              style={[styles.blurNote, { backgroundColor: colors.background }]}
              testID="photo-blurred"
            >
              <AppText variant="label" center>
                🔒{' '}
                {afterMatch
                  ? t('blur.afterMatch')
                  : t('blur.byChoice', { name: profile.displayName })}
              </AppText>
            </View>
          ) : null}
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
          {profile.atEvent ? (
            <View
              testID="event-badge"
              style={[styles.verified, { backgroundColor: colors.successSoft }]}
              accessible
              accessibilityLabel={t('badge.eventLabel')}
            >
              <AppText variant="label" tone="success">
                📍 {t('badge.event')}
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
        {faithLine ? (
          // Phase 62b: only while the community's faith module is on.
          <AppText
            variant="body"
            testID="faith"
            accessibilityLabel={t('faith.cardLabel', { text: faithLine })}
          >
            {faithLine}
          </AppText>
        ) : null}
        {identityLine ? (
          // Phase 62a: only what the member shows this viewer; one sentence for screen readers.
          <AppText
            variant="body"
            testID="identity"
            accessibilityLabel={t('identity.cardLabel', { text: identityLine })}
          >
            {identityLine}
          </AppText>
        ) : null}
        {profile.accessNeeds.length > 0 ? (
          // Phase 25: only needs the member chose to show; one sentence for screen readers.
          <AppText variant="body" testID="access-needs">
            ♿ {profile.accessNeeds.map((need) => t(`access.short.${need}`)).join(' · ')}
          </AppText>
        ) : null}

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
          <View style={styles.takes} testID="friend-takes">
            <AppText variant="heading">
              {t('takes.onProfile', { name: profile.displayName })}
            </AppText>
            <View
              style={styles.takes}
              role="list"
              accessibilityLabel={t('takes.onProfile', { name: profile.displayName })}
            >
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
              <VoiceTranscript
                path={`/v1/audio/${profile.voicePrompt.audioId}`}
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
  blurNote: {
    position: 'absolute',
    top: '40%',
    start: spacing.lg,
    end: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
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
