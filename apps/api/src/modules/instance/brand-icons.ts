// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { DISCREET_COLOR, type BrandIconName } from '@nexaheart/shared';
import sharp from 'sharp';

/** Size of each icon, and how much of it the logo may fill (the rest is a white margin). */
const SPECS: Record<BrandIconName, { size: number; fill: number }> = {
  'icon-192.png': { size: 192, fill: 0.8 },
  'icon-512.png': { size: 512, fill: 0.8 },
  // Android crops maskable icons to a circle or a rounded square: keep the logo in the safe zone.
  'maskable-512.png': { size: 512, fill: 0.6 },
  'apple-touch-icon.png': { size: 180, fill: 0.8 },
};

/**
 * Phase 59: a home-screen icon from the community's logo (already scanned and re-encoded to WebP
 * by the upload pipeline): the logo, whole, centred on a white square.
 */
export async function brandIcon(logo: Buffer, name: BrandIconName): Promise<Buffer> {
  const { size, fill } = SPECS[name];
  const inner = Math.round(size * fill);
  const fitted = await sharp(logo, { limitInputPixels: 40_000_000 })
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: '#FFFFFF' },
  })
    .composite([{ input: fitted, gravity: 'center' }])
    .flatten({ background: '#FFFFFF' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Phase 67b: a plain icon for a discreet app: a grey square with three light lines, like a note,
 * so a home screen says nothing about dating.
 */
export async function plainIcon(name: BrandIconName): Promise<Buffer> {
  const { size, fill } = SPECS[name];
  const inner = Math.round(size * fill);
  const line = (y: number, w: number) =>
    `<rect x="${(size - inner) / 2 + inner * 0.18}" y="${(size - inner) / 2 + inner * y}" width="${inner * w}" height="${inner * 0.08}" rx="${inner * 0.04}" fill="#E5E7EB"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${DISCREET_COLOR}"/>
    ${line(0.25, 0.64)}${line(0.46, 0.64)}${line(0.67, 0.4)}
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
