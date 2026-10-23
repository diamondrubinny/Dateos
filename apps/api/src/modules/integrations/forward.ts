// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Database } from '@nexaheart/db';
import { sql } from 'drizzle-orm';
import type { AppEvent } from '../../lib/app-events.js';
import type { IntegrationService } from './service.js';

/**
 * Turns what happened into webhooks (opaque ids) and team alerts (a count and a link to the
 * dashboard). Never a name, a message, a photo or an email address.
 */
export async function forwardToIntegrations(
  event: AppEvent,
  integrations: IntegrationService,
  db: Database,
): Promise<void> {
  switch (event.type) {
    case 'report.created': {
      await integrations.emit('report.created', { reportId: event.reportId });
      const link = integrations.adminLink(`reports/${event.reportId}`);
      await integrations.alert(
        event.urgent ? 'report_urgent' : 'report_new',
        event.urgent
          ? `🚨 An urgent report is waiting for a moderator: ${link}`
          : `A new report is waiting: ${link}`,
      );
      return;
    }
    case 'report.resolved':
      return integrations.emit('report.resolved', { reportId: event.reportId });
    case 'waitlist.joined': {
      const { rows } = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM waitlist WHERE status = 'pending'`,
      );
      const waiting = rows[0]?.n ?? 0;
      return integrations.alert(
        'waitlist_new',
        `Someone joined the waitlist. Waiting now: ${waiting}. ${integrations.adminLink('signup')}`,
      );
    }
    case 'member.joined':
      return integrations.emit('member.joined', { memberId: event.memberId });
    case 'member.deleted':
      return integrations.emit('member.deleted', { memberId: event.memberId });
    case 'match.created':
      // Only the match: never who matched with whom.
      return integrations.emit('match.created', { matchId: event.matchId });
    case 'event.created':
      return integrations.emit('event.created', { eventId: event.eventId });
  }
}
