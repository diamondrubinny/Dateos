/**
 * Generates the app icons from one design: a heart with a small network of three connected
 * points inside ("Nexa": connection), white on the brand violet.
 * Usage: node apps/mobile/scripts/make-icons.mjs
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');
// sharp is a dependency of the worker; reuse it instead of adding one to the app.
const sharp = createRequire(join(here, '../../worker/package.json'))('sharp');

const VIOLET = '#6D28D9';
const HEART =
  'M512 836 C 300 690 168 560 168 408 C 168 296 254 214 362 214 C 428 214 482 250 512 300 ' +
  'C 542 250 596 214 662 214 C 770 214 856 296 856 408 C 856 560 724 690 512 836 Z';
// Three connected points: the network inside the heart.
const NODES = [
  [398, 420],
  [626, 420],
  [512, 610],
];
const network = (color) =>
  `<g stroke="${color}" stroke-width="26" stroke-linecap="round">
     <line x1="${NODES[0][0]}" y1="${NODES[0][1]}" x2="${NODES[1][0]}" y2="${NODES[1][1]}"/>
     <line x1="${NODES[1][0]}" y1="${NODES[1][1]}" x2="${NODES[2][0]}" y2="${NODES[2][1]}"/>
     <line x1="${NODES[2][0]}" y1="${NODES[2][1]}" x2="${NODES[0][0]}" y2="${NODES[0][1]}"/>
   </g>
   ${NODES.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="44" fill="${color}"/>`).join('')}`;

const background = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#5B21B6"/>
  </linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/>`;

/** The heart and network, scaled around the centre (1 = full 1024 canvas). */
const mark = (scale, heartColor, netColor) =>
  `<g transform="translate(512 525) scale(${scale}) translate(-512 -525)">
     <path d="${HEART}" fill="${heartColor}"/>${network(netColor)}</g>`;

const svg = (body) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${body}</svg>`);

async function png(body, size, file) {
  await sharp(svg(body)).resize(size, size).png({ compressionLevel: 9 }).toFile(join(assets, file));
  process.stdout.write(`${file} ${size}x${size}\n`);
}

// iOS / default icon: full-bleed, no transparency (the stores reject alpha).
await png(background + mark(0.86, '#FFFFFF', VIOLET), 1024, 'icon.png');
// Android adaptive icon: launchers crop to a circle or squircle, so the mark sits in the safe zone.
await png(mark(0.6, '#FFFFFF', VIOLET), 512, 'android-icon-foreground.png');
await png(background, 512, 'android-icon-background.png');
// Monochrome (themed icons): one colour; the network is cut out of the heart.
await png(
  `<defs><mask id="m"><rect width="1024" height="1024" fill="white"/>${network('black')}</mask></defs>
   <g mask="url(#m)">${mark(0.6, '#FFFFFF', '#FFFFFF')}</g>`,
  432,
  'android-icon-monochrome.png',
);
// Splash: the mark on the splash background colour from app.json.
await png(mark(0.7, VIOLET, '#FFFFFF'), 1024, 'splash-icon.png');
await png(background + mark(0.9, '#FFFFFF', VIOLET), 48, 'favicon.png');
