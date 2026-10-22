import { useTranslation } from 'react-i18next';
import { LegalPage } from '../components/LegalPage';

export default function AccessibilityPage() {
  const { t } = useTranslation();
  return <LegalPage title={t('legal.accessibilityTitle')} body={t('legal.accessibilityBody')} />;
}
