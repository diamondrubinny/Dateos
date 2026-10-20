import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Screen } from './Screen';

export const LEGAL_UPDATED = '2026-10-20';

export function LegalPage({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation();
  return (
    <Screen back title={title}>
      <Banner tone="info" message={t('common.draftNotice')} />
      <AppText variant="body">{body}</AppText>
      <AppText variant="caption" tone="muted">
        {t('legal.updated', { date: LEGAL_UPDATED })}
      </AppText>
    </Screen>
  );
}
