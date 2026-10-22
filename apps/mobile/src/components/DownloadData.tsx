// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadMyData } from '../lib/export';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

/** "Download my data" (access and portability). Also offered to suspended members. */
export function DownloadData() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'info' | 'error'; message: string }>();

  const run = async () => {
    setBusy(true);
    setNote(undefined);
    const result = await downloadMyData().catch(() => 'error' as const);
    setBusy(false);
    if (result === 'done') setNote({ tone: 'info', message: t('settings.downloadDone') });
    else if (result === 'rate_limited')
      setNote({ tone: 'info', message: t('settings.downloadLimited') });
    else setNote({ tone: 'error', message: t('common.genericError') });
  };

  return (
    <>
      <AppText variant="body" tone="muted">
        {t('settings.downloadHint')}
      </AppText>
      <Button
        variant="secondary"
        label={t('settings.download')}
        loading={busy}
        onPress={() => void run()}
      />
      {note ? <Banner tone={note.tone} message={note.message} /> : null}
    </>
  );
}
