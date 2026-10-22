// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { readFileSync } from 'node:fs';
import type { Place } from '@nexaheart/shared';

/**
 * The bundled city list for travel mode (phase 18c): GeoNames cities of 100,000+ people, and every
 * town of 15,000+ in Israel and the Palestinian territories (CC BY 4.0, see NOTICE). Rebuilt with
 * scripts/build-cities.mjs. Searched in memory, so what members type never leaves the server.
 */
export interface City extends Place {
  lat: number;
  lng: number;
  population: number;
}

interface CityFile {
  cities: {
    id: number;
    en: string;
    he: string | null;
    ar: string | null;
    ru: string | null;
    cc: string;
    lat: number;
    lng: number;
    pop: number;
  }[];
}

/** Lowercase, without accents, Hebrew vowel marks or punctuation, so "tel-aviv" finds "Tel Aviv". */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-֑ͯ-ׇً-ٟ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export class CityIndex {
  private readonly byId = new Map<number, City>();
  private readonly keys: { city: City; names: string[] }[] = [];

  constructor(file: CityFile) {
    for (const c of file.cities) {
      const city: City = {
        id: c.id,
        names: { en: c.en, he: c.he, ar: c.ar, ru: c.ru },
        country: c.cc,
        lat: c.lat,
        lng: c.lng,
        population: c.pop,
      };
      this.byId.set(city.id, city);
      const names = [c.en, c.he, c.ar, c.ru].filter((n): n is string => Boolean(n)).map(normalize);
      this.keys.push({ city, names });
    }
  }

  static load(path = new URL('../../../data/cities.json', import.meta.url)): CityIndex {
    return new CityIndex(JSON.parse(readFileSync(path, 'utf8')) as CityFile);
  }

  get(id: number): City | undefined {
    return this.byId.get(id);
  }

  /**
   * Names starting with the query first (any word of the name), then names containing it; bigger
   * cities first within each group. The list is already sorted by population.
   */
  search(query: string, limit = 10): Place[] {
    const q = normalize(query);
    if (q.length < 2) return [];
    const starts: City[] = [];
    const contains: City[] = [];
    for (const { city, names } of this.keys) {
      if (names.some((n) => n.startsWith(q) || n.includes(` ${q}`))) starts.push(city);
      else if (names.some((n) => n.includes(q))) contains.push(city);
      if (starts.length >= limit) break;
    }
    return [...starts, ...contains]
      .slice(0, limit)
      .map(({ id, names, country }) => ({ id, names, country }));
  }
}
