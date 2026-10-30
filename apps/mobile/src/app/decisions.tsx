// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { AccountDecisions } from '../components/AccountDecisions';
import { AppText } from '../components/AppText';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';

/** Phase 61: decisions our moderators took about my account, why, and the appeal. */
function Decisions() {
  const { t } = useTranslation();
  return (
    <Screen back title={t('decisions.title')}>
      <AppText variant="body">{t('decisions.intro')}</AppText>
      <AccountDecisions emptyText={t('decisions.empty')} />
    </Screen>
  );
}

export default function DecisionsRoute() {
  return (
    <RequireSession>
      <Decisions />
    </RequireSession>
  );
}
