/**
 * Builds the marketing site into site/dist: resized WebP screenshots for each language from
 * docs/screenshots, and index.html (the page wrapped in a full document with meta tags).
 * Usage: node site/build.mjs
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(here, 'dist');
// sharp is a dependency of the worker; reuse it instead of adding one for the site.
const sharp = createRequire(join(root, 'apps/worker/package.json'))('sharp');

const LANGS = ['en', 'he'];
const PHONE_WIDTH = 600;
const DESKTOP_WIDTH = 1600;
const SITE_URL = process.env.SITE_URL ?? '';

const page = await readFile(join(here, 'src/page.html'), 'utf8');
const shots = [...new Set([...page.matchAll(/data-shot="([\w-]+)"/g)].map((m) => m[1]))];

await rm(dist, { recursive: true, force: true });
for (const lang of LANGS) {
  await mkdir(join(dist, 'img', lang), { recursive: true });
  for (const shot of shots) {
    const source = join(root, 'docs/screenshots', lang, `${shot}.png`);
    const desktop = shot.startsWith('admin-');
    await sharp(source)
      .resize({ width: desktop ? DESKTOP_WIDTH : PHONE_WIDTH })
      .webp({ quality: 82 })
      .toFile(join(dist, 'img', lang, `${shot}.webp`));
  }
}
await copyFile(join(root, 'docs/screenshots/showcase-en.png'), join(dist, 'og.png'));
await copyFile(join(root, 'apps/mobile/assets/favicon.png'), join(dist, 'favicon.png'));

// The page starts with <title>, <meta> and <link> tags meant for the document head.
const headEnd = page.indexOf('<style>');
const head = page.slice(0, headEnd).trim();
const body = page.slice(headEnd);
const description = /name="description" content="([^"]+)"/.exec(head)?.[1] ?? '';
const og = [
  `<meta property="og:type" content="website">`,
  `<meta property="og:title" content="Dateos">`,
  `<meta property="og:description" content="${description}">`,
  // Social previews need an absolute image URL, so it is only added when SITE_URL is known.
  ...(SITE_URL
    ? [`<meta property="og:image" content="${SITE_URL.replace(/\/$/, '')}/og.png">`]
    : []),
  `<meta name="twitter:card" content="summary_large_image">`,
  `<link rel="icon" type="image/png" href="favicon.png">`,
].join('\n');

const html = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
${og}
<style>:root{padding-block:env(safe-area-inset-top,0px) env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
await writeFile(join(dist, 'index.html'), html);
process.stdout.write(`site/dist: index.html and ${shots.length * LANGS.length} images\n`);
