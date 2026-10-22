// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <Screen title={t('notFound.title')}>
      <Button label={t('notFound.home')} onPress={() => router.replace('/')} />
    </Screen>
  );
}
