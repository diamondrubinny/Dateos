// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { Button } from './Button';
import { Checkbox } from './Choice';
import { useChatSettings, useSetReach } from '../lib/chat-queries';

/**
 * Phase 67a, Settings → "Discretion": hide my distance, discreet notifications, this device's
 * lock code and the community's local help.
 */
export function Discretion({
  onError,
  hasResources,
}: {
  onError: () => void;
  hasResources: boolean;
}) {
  const { t } = useTranslation();
  const settings = useChatSettings();
  const set = useSetReach();
  return (
    <>
      <AppText variant="heading">{t('discretion.title')}</AppText>
      <Checkbox
        label={t('discretion.hideDistanceLabel')}
        hint={t('discretion.hideDistanceHint')}
        checked={settings.data?.hideDistance ?? false}
        onChange={(v) => set.mutate({ hideDistance: v }, { onError })}
      />
      <Checkbox
        label={t('discretion.discreetLabel')}
        hint={t('discretion.discreetHint')}
        checked={settings.data?.discreetNotifications ?? false}
        onChange={(v) => set.mutate({ discreetNotifications: v }, { onError })}
      />
      <Button
        variant="secondary"
        label={t('appLock.title')}
        onPress={() => router.push('/app-lock')}
      />
      {hasResources ? (
        <Button
          variant="secondary"
          label={t('helpNearYou.title')}
          onPress={() => router.push('/help-near-you')}
        />
      ) : null}
    </>
  );
}
