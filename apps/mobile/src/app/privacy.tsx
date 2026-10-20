import { useTranslation } from 'react-i18next';
import { LegalPage } from '../components/LegalPage';

export default function PrivacyPage() {
  const { t } = useTranslation();
  return <LegalPage title={t('legal.privacyTitle')} body={t('legal.privacyBody')} />;
}
