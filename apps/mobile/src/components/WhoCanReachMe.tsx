// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { DAILY_LIKE_LIMITS } from '@nexaheart/shared';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { Checkbox, ChoiceGroup } from './Choice';
import { useChatSettings, useSetReach } from '../lib/chat-queries';

type Limit = 'off' | `${(typeof DAILY_LIKE_LIMITS)[number]}`;

/**
 * Phase 65, Settings → "Who can reach me": at most N new likes a day, and only verified members.
 * Nobody is told that a member chose either.
 */
export function WhoCanReachMe({ onError }: { onError: () => void }) {
  const { t } = useTranslation();
  const settings = useChatSettings();
  const setReach = useSetReach();
  const limit: Limit =
    settings.data?.dailyLikeLimit != null ? (`${settings.data.dailyLikeLimit}` as Limit) : 'off';
  return (
    <>
      <AppText variant="heading">{t('reach.title')}</AppText>
      <AppText variant="caption" tone="muted">
        {t('reach.intro')}
      </AppText>
      <ChoiceGroup<Limit>
        label={t('reach.likesLabel')}
        options={[
          { value: 'off', label: t('reach.noLimit') },
          ...DAILY_LIKE_LIMITS.map((n) => ({
            value: `${n}` as Limit,
            label: t('reach.likesPerDay', { count: n }),
          })),
        ]}
        selected={[limit]}
        onChange={([v]) => {
          if (!v || v === limit) return;
          setReach.mutate({ dailyLikeLimit: v === 'off' ? null : Number(v) }, { onError });
        }}
      />
      <AppText variant="caption" tone="muted">
        {t('reach.likesHint')}
      </AppText>
      <Checkbox
        label={t('reach.verifiedLabel')}
        hint={t('reach.verifiedHint')}
        checked={settings.data?.verifiedContactOnly ?? false}
        onChange={(v) => setReach.mutate({ verifiedContactOnly: v }, { onError })}
      />
      {/* Phase 66a: blurred on the server until shown to a match, in the chat. */}
      <Checkbox
        label={t('blur.settingLabel')}
        hint={t('blur.settingHint')}
        checked={settings.data?.blurPhotos ?? false}
        onChange={(v) => setReach.mutate({ blurPhotos: v }, { onError })}
      />
    </>
  );
}
