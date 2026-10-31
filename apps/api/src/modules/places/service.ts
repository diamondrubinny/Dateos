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

  /** Phase 67b: the countries this community considers dangerous (read fresh). */
  private async riskCountries(): Promise<string[]> {
    const { rows } = await this.db.execute<{ list: string[] | null }>(
      sql`SELECT risk_countries AS list FROM instance_settings WHERE id = 1`,
    );
    return rows[0]?.list ?? [];
  }

  async state(userId: string): Promise<TravelState> {
    const [row] = await this.db
      .select({
        cityId: locations.travelCityId,
        until: locations.travelUntil,
        hidden: locations.travelHidden,
      })
      .from(locations)
      .where(and(eq(locations.userId, userId), gt(locations.travelUntil, sql`now()`)));
    const city = row?.cityId ? this.cities.get(row.cityId) : undefined;
    if (!row?.until || !city) return null;
    return {
      id: city.id,
      names: city.names,
      country: city.country,
      until: row.until.toISOString(),
      atRisk: (await this.riskCountries()).includes(city.country),
      hidden: row.hidden,
    };
  }

  async start(userId: string, input: TravelInput, now = new Date()): Promise<TravelState> {
    const city = this.cities.get(input.cityId);
    if (!city) throw new HttpError(400, ErrorCode.ValidationError, 'Unknown city.');
    const until = new Date(now.getTime() + input.days * 86_400_000);
    // Phase 67b: a country at risk hides the member from new people for the trip, unless they
    // chose not to.
    const atRisk = (await this.riskCountries()).includes(city.country);
    const hidden = atRisk && input.hideWhileThere !== false;
    await this.end(userId); // a trip replaced ends the previous one's hiding first
    const point = sql`ST_SetSRID(ST_MakePoint(${city.lng}, ${city.lat}), 4326)::geography`;
    const updated = await this.db.execute(sql`
      UPDATE locations
      SET travel_city_id = ${city.id}, travel_geo = ${point},
          travel_started_at = ${now}, travel_until = ${until}, travel_hidden = ${hidden}
      WHERE user_id = ${userId}`);
    // Travel moves the starting point of an existing location; it never creates one.
    if (!updated.rowCount) {
      throw new HttpError(409, ErrorCode.Conflict, 'Set your location before travelling.');
    }
    if (hidden) {
      // As "take a break" (phase 18a) until the trip ends; a longer or open-ended break stays.
      await this.db.execute(sql`
        UPDATE "user" SET paused_at = COALESCE(paused_at, ${now}),
          paused_until = CASE WHEN paused_at IS NOT NULL AND paused_until IS NULL THEN NULL
                              ELSE GREATEST(COALESCE(paused_until, ${until}), ${until}) END
        WHERE id = ${userId}`);
    }
    return {
      id: city.id,
      names: city.names,
      country: city.country,
      until: until.toISOString(),
      atRisk,
      hidden,
    };
  }

  /** Ending a trip early deletes it at once (nothing to keep). */
  async end(userId: string): Promise<void> {
    // Phase 67b: the hiding this trip started ends with it (a break the member chose stays).
    await this.db.execute(sql`
      UPDATE "user" u SET paused_at = NULL, paused_until = NULL
      FROM locations l
      WHERE l.user_id = u.id AND u.id = ${userId} AND l.travel_hidden
        AND u.paused_until = l.travel_until`);
    await this.db
      .update(locations)
      .set({
        travelCityId: null,
        travelGeo: null,
        travelStartedAt: null,
        travelUntil: null,
        travelHidden: false,
      })
      .where(eq(locations.userId, userId));
  }
}
