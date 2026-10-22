// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { cityName } from '@nexaheart/shared';
import { describe, expect, it } from 'vitest';
import { CityIndex, normalize } from '../src/modules/places/cities.js';

describe('travel mode cities', () => {
  const cities = CityIndex.load();

  it('normalises accents, Hebrew vowel marks and punctuation', () => {
    expect(normalize('Tel-Aviv')).toBe('tel aviv');
    expect(normalize('Petaẖ Tiqva')).toBe('petah tiqva');
    expect(normalize('יְרוּשָׁלַיִם')).toBe('ירושלים');
  });

  it('finds a city by any of its names, bigger cities first', () => {
    for (const q of ['jerusalem', 'ירושלים', 'القدس', 'Иерусалим']) {
      expect(cities.search(q)[0]?.names.en, q).toBe('Jerusalem');
    }
    expect(cities.search('york')[0]?.names.en).toBe('New York City');
    expect(cities.search('x')).toEqual([]);
    expect(cities.search('ber', 3)).toHaveLength(3);
  });

  it('includes the towns of Israel and the Palestinian territories, with local names', () => {
    const nazareth = cities.search('nazareth')[0]!;
    expect(nazareth).toMatchObject({ country: 'IL', names: { he: 'נצרת', ar: 'الناصرة' } });
    expect(cities.search('ramallah')[0]?.country).toBe('PS');
  });

  it("names a city in the member's language, or in English", () => {
    const haifa = cities.search('haifa')[0]!;
    expect(cityName(haifa.names, 'he')).toBe('חיפה');
    expect(cityName(haifa.names, 'ru-RU')).toBe('Хайфа');
    expect(cityName(haifa.names, 'fr')).toBe('Haifa');
    expect(cityName({ en: 'Rahat', he: null, ar: null, ru: null }, 'he')).toBe('Rahat');
  });
});
