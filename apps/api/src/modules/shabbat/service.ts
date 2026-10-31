// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  currentRest,
  DEFAULT_CANDLE_MINUTES,
  ErrorCode,
  restWindows,
  type RestWindow,
  type ShabbatSettings,
  type ShabbatSettingsInput,
} from '@nexaheart/shared';
import { eq, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';

const { preferences } = schema;

type RestRow = {
  user_id: string;
  show: boolean;
  candles: number;
  second_day: boolean;
  time_zone: string | null;
  lat: number | null;
  lng: number | null;
};

/** Turning it on needs this consent, given and not withdrawn since. */
export const shabbatConsentSql = (userId: string) => sql`COALESCE((
  SELECT granted FROM consents WHERE user_id = ${userId} AND kind = 'shabbat'
  ORDER BY created_at DESC LIMIT 1), false)`;

/**
 * Phase 74a: Shabbat and holiday mode. Times come from the member's approximate location (the
 * ~1 km cell, or the travel city while travelling) and the shared calculation in `zmanim`.
 */
export class ShabbatService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  /** Members in Shabbat mode among `userIds`, with what's needed to work out their times. */
  private async rows(userIds: string[]): Promise<RestRow[]> {
    if (userIds.length === 0) return [];
    const at = new Date(this.now()).toISOString();
    const { rows } = await this.db.execute<RestRow>(sql`
      SELECT p.user_id, p.shabbat_show AS show, p.shabbat_candles AS candles,
             p.shabbat_second_day AS second_day, p.shabbat_time_zone AS time_zone,
             ST_Y(x.g::geometry) AS lat, ST_X(x.g::geometry) AS lng
      FROM preferences p
      LEFT JOIN locations l ON l.user_id = p.user_id
      LEFT JOIN LATERAL (SELECT CASE
          WHEN l.travel_geo IS NOT NULL AND l.travel_until > ${at}::timestamptz THEN l.travel_geo
          ELSE l.geo END AS g) x ON true
      WHERE p.user_id = ANY(${sql.param(userIds)}::text[]) AND p.shabbat_mode`);
    return rows;
  }

  private options(r: RestRow) {
    return { candles: r.candles, secondDay: r.second_day };
  }

  /** Who among `userIds` is resting now and chose to tell matches, with the rest. */
  async restingShown(userIds: string[]): Promise<Map<string, RestWindow>> {
    const now = this.now();
    const out = new Map<string, RestWindow>();
    for (const r of await this.rows(userIds)) {
      if (!r.show || r.lat === null || r.lng === null) continue;
      const rest = currentRest(now, r.lat, r.lng, r.time_zone, this.options(r));
      if (rest) out.set(r.user_id, rest);
    }
    return out;
  }

  async settings(userId: string): Promise<ShabbatSettings> {
    const [p] = await this.db
      .select({
        on: preferences.shabbatMode,
        show: preferences.shabbatShow,
        candles: preferences.shabbatCandles,
        secondDay: preferences.shabbatSecondDay,
      })
      .from(preferences)
      .where(eq(preferences.userId, userId));
    const [row] = await this.rows([userId]);
    const located = row ? row.lat !== null && row.lng !== null : await this.located(userId);
    const next =
      row && row.lat !== null && row.lng !== null
        ? (restWindows(this.now(), row.lat, row.lng, row.time_zone, this.options(row), 14)[0] ??
          null)
        : null;
    return {
      on: p?.on ?? false,
      showMatches: p?.show ?? false,
      candles: p?.candles ?? DEFAULT_CANDLE_MINUTES,
      secondDay: p?.secondDay ?? false,
      located,
      next: next
        ? {
            start: new Date(next.start).toISOString(),
            end: new Date(next.end).toISOString(),
            kind: next.kind,
          }
        : null,
    };
  }

  private async located(userId: string): Promise<boolean> {
    const { rows } = await this.db.execute(sql`SELECT 1 FROM locations WHERE user_id = ${userId}`);
    return rows.length > 0;
  }

  async update(userId: string, input: ShabbatSettingsInput): Promise<ShabbatSettings> {
    if (input.on === true) {
      const { rows } = await this.db.execute<{ ok: boolean }>(
        sql`SELECT ${shabbatConsentSql(userId)} AS ok`,
      );
      if (!rows[0]?.ok) {
        throw new HttpError(
          403,
          ErrorCode.Forbidden,
          'Agree to the Shabbat mode consent first: keeping Shabbat is religious information.',
        );
      }
    }
    if (input.timeZone !== undefined) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: input.timeZone });
      } catch {
        throw new HttpError(400, ErrorCode.ValidationError, 'Unknown time zone.');
      }
    }
    const values = {
      ...(input.on !== undefined ? { shabbatMode: input.on } : {}),
      ...(input.showMatches !== undefined ? { shabbatShow: input.showMatches } : {}),
      ...(input.candles !== undefined ? { shabbatCandles: input.candles } : {}),
      ...(input.secondDay !== undefined ? { shabbatSecondDay: input.secondDay } : {}),
      ...(input.timeZone !== undefined ? { shabbatTimeZone: input.timeZone } : {}),
      // Turned off: nothing waits any more.
      ...(input.on === false ? { shabbatHeld: false } : {}),
    };
    if (Object.keys(values).length > 0) {
      await this.db.update(preferences).set(values).where(eq(preferences.userId, userId));
    }
    if (input.on !== undefined) {
      await audit(this.db, {
        actorId: userId,
        action: input.on ? 'shabbat.on' : 'shabbat.off',
        targetType: 'user',
        targetId: userId,
      });
    }
    return this.settings(userId);
  }
}
