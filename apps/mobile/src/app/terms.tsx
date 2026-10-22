import { useTranslation } from 'react-i18next';
import { LegalPage } from '../components/LegalPage';

export default function TermsPage() {
  const { t } = useTranslation();
  return <LegalPage title={t('legal.termsTitle')} body={t('legal.termsBody')} />;
}
