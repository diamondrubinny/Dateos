// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import sharp from 'sharp';

/** Illustrated stand-ins for profile photos: no real people appear in screenshots. */
const scenes = {
  sunset: `
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c1d95"/><stop offset="0.55" stop-color="#f472b6"/><stop offset="1" stop-color="#fdba74"/></linearGradient>
    <rect width="1080" height="1350" fill="url(#sky)"/>
    <circle cx="540" cy="760" r="190" fill="#fde68a"/>
    <rect y="820" width="1080" height="530" fill="#1e3a8a"/>
    <g fill="#93c5fd" opacity="0.7"><rect x="380" y="870" width="320" height="10" rx="5"/><rect x="430" y="930" width="220" height="10" rx="5"/><rect x="470" y="990" width="140" height="10" rx="5"/></g>`,
  coffee: `
    <rect width="1080" height="1350" fill="#fef3c7"/>
    <circle cx="540" cy="700" r="330" fill="#fde68a"/>
    <rect x="350" y="560" width="380" height="380" rx="60" fill="#7c2d12"/>
    <path d="M730 640 h70 a80 80 0 0 1 0 160 h-70" fill="none" stroke="#7c2d12" stroke-width="40"/>
    <ellipse cx="540" cy="575" rx="170" ry="38" fill="#a16207"/>
    <path d="M470 470 q-30 -60 0 -120 M540 470 q-30 -60 0 -120 M610 470 q-30 -60 0 -120" stroke="#92400e" stroke-width="16" fill="none" stroke-linecap="round" opacity="0.5"/>`,
  mountains: `
    <linearGradient id="day" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bae6fd"/><stop offset="1" stop-color="#e0f2fe"/></linearGradient>
    <rect width="1080" height="1350" fill="url(#day)"/>
    <circle cx="820" cy="300" r="90" fill="#fef08a"/>
    <path d="M-50 1100 L330 520 L620 1100 Z" fill="#6d28d9"/>
    <path d="M330 520 L400 630 L360 610 L320 660 L270 600 Z" fill="#ffffff"/>
    <path d="M300 1100 L720 420 L1150 1100 Z" fill="#7c3aed"/>
    <path d="M720 420 L800 550 L750 520 L700 580 L650 530 Z" fill="#ffffff"/>
    <rect y="1050" width="1080" height="300" fill="#16a34a"/>`,
};

export type Scene = keyof typeof scenes;

/** JPEG with fake GPS EXIF, so the screenshots also exercise metadata stripping. */
export async function demoPhoto(scene: Scene): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">${scenes[scene]}</svg>`;
  return sharp(Buffer.from(svg))
    .withExif({
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '32/1 4/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '34/1 46/1 0/1',
      },
    })
    .jpeg({ quality: 88 })
    .toBuffer();
}

export const demoScenes: Scene[] = ['sunset', 'coffee', 'mountains'];
