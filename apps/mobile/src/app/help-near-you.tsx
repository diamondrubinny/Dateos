// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Loading } from '../components/Loading';
import { Screen } from '../components/Screen';
import { useInstance } from '../lib/queries';

/** Phase 67a: local help the community lists (legal aid, emergency lines, organisations). */
export default function HelpNearYou() {
  const { t } = useTranslation();
  const instance = useInstance();
  if (!instance.data) return <Loading />;
  const text = instance.data.community.safetyResources;
  return (
    <Screen back title={t('helpNearYou.title')}>
      <AppText variant="body">{t('helpNearYou.intro', { name: instance.data.name })}</AppText>
      <AppText variant="body" userContent testID="safety-resources">
        {text ?? t('helpNearYou.none')}
      </AppText>
    </Screen>
  );
}
