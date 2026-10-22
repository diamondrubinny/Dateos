// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';

type Tx = Pick<Database, 'insert'>;

export interface AuditEvent {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Never include personal data (emails, names, message text) here. */
  meta?: Record<string, string | number | boolean>;
}

export async function audit(db: Tx, event: AuditEvent): Promise<void> {
  await db.insert(schema.auditLogs).values({
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    meta: event.meta ?? null,
  });
}
