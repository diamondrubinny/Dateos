// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { EventList } from '../../components/EventCard';
import { EventMisses } from '../../components/EventMisses';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { useEvents } from '../../lib/event-queries';

function EventsScreen() {
  const { t } = useTranslation();
  const events = useEvents();
  if (events.isPending) return <Loading />;
  return (
    <Screen back title={t('events.title')}>
      <AppText variant="body">{t('events.intro')}</AppText>
      <EventMisses />
      {events.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {events.data && events.data.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('events.empty')}
        </AppText>
      ) : null}
      <EventList events={events.data ?? []} />
    </Screen>
  );
}

export default function EventsRoute() {
  return (
    <RequireSession>
      <EventsScreen />
    </RequireSession>
  );
}
