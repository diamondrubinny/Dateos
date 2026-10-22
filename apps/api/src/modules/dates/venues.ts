// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  type AdminVenue,
  ErrorCode,
  type Venue,
  type VenueInput,
  type VenueUpdate,
} from '@nexaheart/shared';
import { asc, desc, eq } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';

const { venues } = schema;
/** A community's own list; more than this is a sign of misuse and would make the picker unusable. */
export const MAX_VENUES = 500;

type Row = typeof venues.$inferSelect;

const toVenue = (r: Row): Venue => ({
  id: r.id,
  name: r.name,
  area: r.area,
  category: r.category,
  address: r.address,
  note: r.note,
  stepFree: r.stepFree,
});

const toAdmin = (r: Row): AdminVenue => ({
  ...toVenue(r),
  active: r.active,
  updatedAt: r.updatedAt.toISOString(),
});

/** Public places curated by the instance's admins (phase 12). */
export class VenueService {
  constructor(private readonly db: Database) {}

  /** What members can pick from: active places, by area then name. */
  async listActive(): Promise<Venue[]> {
    const rows = await this.db
      .select()
      .from(venues)
      .where(eq(venues.active, true))
      .orderBy(asc(venues.area), asc(venues.name))
      .limit(MAX_VENUES);
    return rows.map(toVenue);
  }

  async listAll(): Promise<AdminVenue[]> {
    const rows = await this.db
      .select()
      .from(venues)
      .orderBy(desc(venues.active), asc(venues.area), asc(venues.name))
      .limit(MAX_VENUES);
    return rows.map(toAdmin);
  }

  async active(id: string): Promise<Row | null> {
    const [row] = await this.db.select().from(venues).where(eq(venues.id, id));
    return row && row.active ? row : null;
  }

  async create(actorId: string, input: VenueInput): Promise<AdminVenue> {
    const count = await this.db.$count(venues);
    if (count >= MAX_VENUES) {
      throw new HttpError(409, ErrorCode.Conflict, `At most ${MAX_VENUES} places.`);
    }
    const [row] = await this.db.insert(venues).values(input).returning();
    await audit(this.db, {
      actorId,
      action: 'venue.create',
      targetType: 'venue',
      targetId: row!.id,
    });
    return toAdmin(row!);
  }

  async update(actorId: string, id: string, patch: VenueUpdate): Promise<AdminVenue> {
    const [row] = await this.db.update(venues).set(patch).where(eq(venues.id, id)).returning();
    if (!row) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
    await audit(this.db, {
      actorId,
      action: 'venue.update',
      targetType: 'venue',
      targetId: id,
      meta: { fields: Object.keys(patch).sort().join(','), active: row.active },
    });
    return toAdmin(row);
  }
}
