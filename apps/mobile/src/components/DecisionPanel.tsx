// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { MatchMode, PublicProfile } from '@nexaheart/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useDisplay } from '../lib/display';
import { useInteract, yourTurnKey, useSaveForLater } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { ProfileCard, type LikeTarget } from './ProfileCard';
import { TextField } from './TextField';

export interface DecisionResult {
  /** 'later' (phase 33): put aside without deciding. */
  kind: 'like' | 'pass' | 'later';
  matched: boolean;
  matchId: string | null;
}

/** Profile plus Pass / Like / "like this prompt or photo with a comment". No gesture-only actions. */
export function DecisionPanel({
  profile,
  onDecided,
  mode = 'date',
  allowLater = false,
}: {
  profile: PublicProfile;
  onDecided: (result: DecisionResult) => void;
  /** Friends mode (phase 22) has its own deck; likes there are friend likes. */
  mode?: MatchMode;
  /** Decks (phase 33): "Maybe later" puts the profile aside without deciding. */
  allowLater?: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const interact = useInteract();
  const { easy } = useDisplay();
  const client = useQueryClient();
  const [target, setTarget] = useState<LikeTarget>();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();

  const saveForLater = useSaveForLater();
  const later = () => {
    setError(undefined);
    saveForLater.mutate(profile.id, {
      onSuccess: () => onDecided({ kind: 'later', matched: false, matchId: null }),
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.status === 409
            ? t('later.full')
            : t('common.genericError'),
        ),
    });
  };

  const decide = async (kind: 'like' | 'pass') => {
    setError(undefined);
    try {
      const result = await interact.mutateAsync({
        targetId: profile.id,
        kind,
        ...(mode === 'friend' ? { mode } : {}),
        ...(kind === 'like' && target ? { itemType: target.itemType, itemId: target.itemId } : {}),
        ...(kind === 'like' && comment.trim() ? { comment: comment.trim() } : {}),
      });
      setTarget(undefined);
      setComment('');
      onDecided({ kind, ...result });
    } catch (e) {
      // Phase 34: liking faster than a person reads profiles.
      if (e instanceof ApiRequestError && e.code === 'SLOW_DOWN')
        return setError(t('discover.slowDown'));
      if (e instanceof ApiRequestError && e.status === 429) return setError(t('discover.limit'));
      if (e instanceof ApiRequestError && e.code === 'YOUR_TURN') {
        void client.invalidateQueries({ queryKey: yourTurnKey });
        return setError(t('focus.likeBlocked'));
      }
      if (e instanceof ApiRequestError && (e.status === 404 || e.status === 409)) {
        return onDecided({ kind, matched: false, matchId: null }); // no longer available: move on
      }
      setError(t('common.genericError'));
    }
  };

  return (
    <View style={styles.wrap}>
      {error ? <Banner tone="error" message={error} /> : null}
      <ProfileCard profile={profile} onLikeItem={setTarget} />
      {target ? (
        <View style={[styles.composer, { backgroundColor: colors.primarySoft }]}>
          <AppText variant="label" tone="primary">
            ♥ {target.label}
          </AppText>
          <TextField
            label={t('discover.commentOptional')}
            optionalLabel={t('common.optional')}
            value={comment}
            onChangeText={setComment}
            placeholder={t('discover.commentPlaceholder')}
            multiline
            maxLength={300}
          />
          <Button
            label={t('discover.send')}
            loading={interact.isPending}
            onPress={() => void decide('like')}
          />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setTarget(undefined)} />
        </View>
      ) : (
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              variant="ghost"
              label={`✕ ${t('discover.pass')}`}
              hint={t('discover.passLabel', { name: profile.displayName })}
              disabled={interact.isPending}
              onPress={() => void decide('pass')}
            />
          </View>
          <View style={styles.action}>
            <Button
              label={mode === 'friend' ? `👋 ${t('friends.connect')}` : `♥ ${t('discover.like')}`}
              hint={t('discover.likeLabel', { name: profile.displayName })}
              loading={interact.isPending}
              onPress={() => void decide('like')}
            />
          </View>
        </View>
      )}
      {allowLater && !target ? (
        <Button
          variant="ghost"
          label={`⏳ ${t('later.button')}`}
          hint={t('later.hint', { name: profile.displayName })}
          loading={saveForLater.isPending}
          disabled={interact.isPending}
          onPress={later}
        />
      ) : null}
      {easy && !target ? (
        // Easy mode (phase 25): what each button does, in plain words.
        <AppText variant="body" tone="muted">
          {t(mode === 'friend' ? 'display.explainFriend' : 'display.explainDecide', {
            name: profile.displayName,
          })}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  composer: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
});
