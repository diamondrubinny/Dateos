// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Builds apps/api/data/cities.json for travel mode (phase 18c) from GeoNames' cities15000.txt
 * (https://download.geonames.org/export/dump/, CC BY 4.0: attribution in NOTICE and the app).
 * Keeps cities with at least 100,000 inhabitants, and every city in the file (15,000+) in Israel and
 * the Palestinian territories: id, names, country code, centre, population.
 * Hebrew, Arabic and Russian names come from alternateNamesV2.txt, filtered to those languages and
 * cities first (it's ~700 MB):
 *   unzip -p alternateNamesV2.zip alternateNamesV2.txt \
 *     | awk -F'\t' 'NR==FNR{ids[$1]=1;next} ($3=="he"||$3=="ar"||$3=="ru") && ($2 in ids)' ids.txt - \
 *     > names.tsv
 * The preferred name wins, then a short name, then the first plain one; historic and colloquial
 * names, and Hebrew with vowel marks (niqqud), are skipped.
 * Usage: node scripts/build-cities.mjs cities15000.txt [names.tsv]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_POPULATION = 100_000;
/** Where most members are: every town of 15,000+ (e.g. Nazareth, Umm al-Fahm, Karmiel). */
const LOCAL_COUNTRIES = new Set(['IL', 'PS']);
const SKIP_FEATURES = new Set(['PPLX', 'PPLH', 'PPLQ']);
const [input, namesFile] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/build-cities.mjs cities15000.txt [names.tsv]');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/api/data/cities.json');

const NIQQUD = /[֑-ׇ]/;
const SCRIPT = { he: /[א-ת]/, ar: /[ء-ي]/, ru: /[А-я]/ };
/** geonameid → language → best name so far, with its rank (lower wins). */
const names = new Map();
if (namesFile) {
  for (const line of readFileSync(namesFile, 'utf8').split('\n')) {
    const [, id, lang, name, preferred, short, colloquial, historic] = line.split('\t');
    if (!name || colloquial === '1' || historic === '1') continue;
    if (lang === 'he' && NIQQUD.test(name)) continue;
    // A few entries are tagged with a language but written in Latin letters.
    if (!SCRIPT[lang]?.test(name)) continue;
    const rank = preferred === '1' ? 0 : short === '1' ? 1 : 2;
    const byLang = names.get(id) ?? {};
    if (!byLang[lang] || rank < byLang[lang].rank) byLang[lang] = { name, rank };
    names.set(id, byLang);
  }
}

const cities = [];
for (const line of readFileSync(input, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const population = Number(f[14]);
  if (!(population >= MIN_POPULATION || LOCAL_COUNTRIES.has(f[8]))) continue;
  // Not neighbourhoods (PPLX), historical (PPLH) or abandoned (PPLQ) places.
  if (SKIP_FEATURES.has(f[7])) continue;
  const local = names.get(f[0]) ?? {};
  const pick = (lang) => local[lang]?.name ?? null;
  cities.push({
    id: Number(f[0]),
    en: f[1],
    he: pick('he'),
    ar: pick('ar'),
    ru: pick('ru'),
    cc: f[8],
    lat: Math.round(Number(f[4]) * 1e4) / 1e4,
    lng: Math.round(Number(f[5]) * 1e4) / 1e4,
    pop: population,
  });
}
cities.sort((a, b) => b.pop - a.pop);
writeFileSync(
  out,
  JSON.stringify({
    source: 'GeoNames cities15000 (https://www.geonames.org), CC BY 4.0',
    minPopulation: MIN_POPULATION,
    everyTownIn: [...LOCAL_COUNTRIES],
    cities,
  }),
);
process.stdout.write(`${cities.length} cities → ${out}\n`);
