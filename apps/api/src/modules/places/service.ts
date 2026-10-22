// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import { ErrorCode, type TravelInput, type TravelState } from '@nexaheart/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import type { CityIndex } from './cities.js';

const { locations } = schema;

/**
 * Travel mode (phase 18c). The trip lives next to the member's own ~1 km cell, which is never
 * replaced: while the trip lasts, discovery measures from the city centre instead. A trip that has
 * ended counts as over at once.
 */
export class TravelService {
  constructor(
    private readonly db: Database,
    private readonly cities: CityIndex,
  ) {}

  async state(userId: string): Promise<TravelState> {
    const [row] = await this.db
      .select({ cityId: locations.travelCityId, until: locations.travelUntil })
      .from(locations)
      .where(and(eq(locations.userId, userId), gt(locations.travelUntil, sql`now()`)));
    const city = row?.cityId ? this.cities.get(row.cityId) : undefined;
    if (!row?.until || !city) return null;
    return {
      id: city.id,
      names: city.names,
      country: city.country,
      until: row.until.toISOString(),
    };
  }

  async start(userId: string, input: TravelInput, now = new Date()): Promise<TravelState> {
    const city = this.cities.get(input.cityId);
    if (!city) throw new HttpError(400, ErrorCode.ValidationError, 'Unknown city.');
    const until = new Date(now.getTime() + input.days * 86_400_000);
    const point = sql`ST_SetSRID(ST_MakePoint(${city.lng}, ${city.lat}), 4326)::geography`;
    const updated = await this.db.execute(sql`
      UPDATE locations
      SET travel_city_id = ${city.id}, travel_geo = ${point},
          travel_started_at = ${now}, travel_until = ${until}
      WHERE user_id = ${userId}`);
    // Travel moves the starting point of an existing location; it never creates one.
    if (!updated.rowCount) {
      throw new HttpError(409, ErrorCode.Conflict, 'Set your location before travelling.');
    }
    return { id: city.id, names: city.names, country: city.country, until: until.toISOString() };
  }

  /** Ending a trip early deletes it at once (nothing to keep). */
  async end(userId: string): Promise<void> {
    await this.db
      .update(locations)
      .set({ travelCityId: null, travelGeo: null, travelStartedAt: null, travelUntil: null })
      .where(eq(locations.userId, userId));
  }
}
