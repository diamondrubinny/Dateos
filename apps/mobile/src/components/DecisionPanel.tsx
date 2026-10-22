import type { PublicProfile } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useInteract } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { ProfileCard, type LikeTarget } from './ProfileCard';
import { TextField } from './TextField';

export interface DecisionResult {
  kind: 'like' | 'pass';
  matched: boolean;
  matchId: string | null;
}

/** Profile plus Pass / Like / "like this prompt or photo with a comment". No gesture-only actions. */
export function DecisionPanel({
  profile,
  onDecided,
}: {
  profile: PublicProfile;
  onDecided: (result: DecisionResult) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const interact = useInteract();
  const [target, setTarget] = useState<LikeTarget>();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();

  const decide = async (kind: 'like' | 'pass') => {
    setError(undefined);
    try {
      const result = await interact.mutateAsync({
        targetId: profile.id,
        kind,
        ...(kind === 'like' && target ? { itemType: target.itemType, itemId: target.itemId } : {}),
        ...(kind === 'like' && comment.trim() ? { comment: comment.trim() } : {}),
      });
      setTarget(undefined);
      setComment('');
      onDecided({ kind, ...result });
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 429) return setError(t('discover.limit'));
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
              label={`♥ ${t('discover.like')}`}
              hint={t('discover.likeLabel', { name: profile.displayName })}
              loading={interact.isPending}
              onPress={() => void decide('like')}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  composer: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
});
