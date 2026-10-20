import { useTranslation } from 'react-i18next';
import { locales } from '../i18n';
import { useLocale } from '../lib/locale';
import { ChoiceGroup } from './Choice';

export function LanguageSwitch() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  return (
    <ChoiceGroup
      label={t('language.label')}
      options={locales.map((value) => ({ value, label: t(`language.${value}`) }))}
      selected={[locale]}
      onChange={([next]) => next && next !== locale && void setLocale(next)}
    />
  );
}
