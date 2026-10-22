// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { Screen } from '../../components/Screen';
import { completeNativeSignIn } from '../../lib/magic-link';

/** The emailed sign-in link opens the app here (native only) with a one-time code. */
export default function AuthCallback() {
  const { t } = useTranslation();
  const { code } = useLocalSearchParams<{ code?: string; error?: string }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!code) return setFailed(true);
    void completeNativeSignIn(code).then((ok) => (ok ? router.replace('/') : setFailed(true)));
  }, [code]);

  if (!failed) return <Loading />;
  return (
    <Screen title={t('signIn.linkFailedTitle')}>
      <Banner tone="error" message={t('signIn.linkFailed')} />
      <Button label={t('signIn.tryAgain')} onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
