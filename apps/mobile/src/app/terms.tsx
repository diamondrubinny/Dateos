// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { LegalPage } from '../components/LegalPage';

export default function TermsPage() {
  const { t } = useTranslation();
  return <LegalPage title={t('legal.termsTitle')} body={t('legal.termsBody')} />;
}
