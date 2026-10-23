// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  BANNED_PHOTO_DISTANCE,
  hammingDistance,
  perceptualHash,
  processImage,
  SAME_PHOTO_DISTANCE,
} from '../src/image.js';

/** A photo-like picture with real texture (fractal noise), different for every seed. */
function scene(seed: number, width = 900, height = 1100): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <filter id="f"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="5" seed="${seed}"/></filter>
    <rect width="100%" height="100%" filter="url(#f)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}
const hash = async (image: Buffer) => (await perceptualHash(image))!;

describe('perceptualHash', () => {
  it('stays close for the same photo resized, re-compressed and re-encoded', async () => {
    const original = await scene(1);
    const smaller = await sharp(original).resize(320).jpeg({ quality: 55 }).toBuffer();
    const processed = (await processImage(original)).data; // WebP, as stored
    const brighter = await sharp(original).modulate({ brightness: 1.15 }).toBuffer();
    const cropped = await sharp(original)
      .extract({ left: 27, top: 33, width: 846, height: 1034 })
      .toBuffer();
    const a = await hash(original);
    for (const copy of [smaller, processed, brighter]) {
      expect(hammingDistance(a, await hash(copy))).toBeLessThanOrEqual(BANNED_PHOTO_DISTANCE);
    }
    expect(hammingDistance(a, await hash(cropped))).toBeLessThanOrEqual(SAME_PHOTO_DISTANCE);
  });

  it('is far apart for different photos', async () => {
    const hashes = await Promise.all([1, 2, 3, 4, 5].map(async (seed) => hash(await scene(seed))));
    for (let i = 0; i < hashes.length; i += 1) {
      for (let j = i + 1; j < hashes.length; j += 1) {
        expect(hammingDistance(hashes[i]!, hashes[j]!)).toBeGreaterThan(SAME_PHOTO_DISTANCE + 8);
      }
    }
    // A mirrored photo is a different picture to the hash.
    const original = await scene(1);
    expect(
      hammingDistance(hashes[0]!, await hash(await sharp(original).flop().toBuffer())),
    ).toBeGreaterThan(SAME_PHOTO_DISTANCE);
  });

  it('handles transparency and fits in a signed 64-bit integer', async () => {
    const png = await sharp({
      create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: await scene(3, 100, 100), left: 0, top: 0 }])
      .png()
      .toBuffer();
    const h = await hash(png);
    expect(h).toBe(BigInt.asIntN(64, h));
  });

  it('gives no hash to images with too little detail', async () => {
    const flat = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#7c3aed' },
    })
      .jpeg()
      .toBuffer();
    expect(await perceptualHash(flat)).toBeNull();
  });

  it('counts bits', () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
    expect(hammingDistance(-1n, 0n)).toBe(64);
    expect(hammingDistance(0b1011n, 0b0001n)).toBe(2);
  });
});
