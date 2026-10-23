// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { allowedPhotoMimeTypes } from '@nexaheart/shared';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export const MAX_DIMENSION = 2048;
/** Rejects decompression bombs before decoding (about 50 megapixels). */
const MAX_INPUT_PIXELS = 50_000_000;
const allowed = new Set<string>(allowedPhotoMimeTypes);

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
}

export class InvalidImageError extends Error {}

/**
 * Re-encodes an upload to WebP. Orientation is applied to the pixels and then ALL metadata
 * (EXIF incl. GPS, XMP, IPTC, ICC) is dropped, because sharp only keeps it on request.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const type = await fileTypeFromBuffer(input);
  if (!type || !allowed.has(type.mime)) throw new InvalidImageError('unsupported_type');
  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
    })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new InvalidImageError('invalid_image');
  }
}

const PHASH_SIZE = 32;
const PHASH_LOW = 8;
/** Below this standard deviation of the 32×32 greyscale pixels, an image has too little detail. */
const MIN_DETAIL = 12;
/** DCT-II basis for 32 points, computed once. */
const DCT = Array.from({ length: PHASH_LOW }, (_, u) =>
  Array.from({ length: PHASH_SIZE }, (_, x) =>
    Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE)),
  ),
);

/**
 * 64-bit perceptual hash (pHash) of an image: shrink to 32×32 greyscale, take the 8×8 lowest
 * frequencies of its discrete cosine transform, and set a bit for each one above their median.
 * Resizing, re-compression, small crops and colour edits barely change it, so near-duplicates are
 * a small Hamming distance apart. Returned as a signed 64-bit value (Postgres `bigint`), or null
 * for images with too little detail (a flat colour or a smooth gradient), whose hash would be
 * unstable or collide with every other flat image.
 */
export async function perceptualHash(image: Buffer): Promise<bigint | null> {
  const { data: pixels, info } = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    // Transparency is flattened onto white so the result has exactly one channel.
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(PHASH_SIZE, PHASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new InvalidImageError('invalid_image');
  const mean = pixels.reduce((sum, p) => sum + p, 0) / pixels.length;
  const variance = pixels.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pixels.length;
  if (Math.sqrt(variance) < MIN_DETAIL) return null;

  // Separable 2D DCT, low frequencies only: rows first, then columns.
  const rows = Array.from({ length: PHASH_SIZE }, (_, y) =>
    DCT.map((basis) => basis.reduce((sum, c, x) => sum + c * pixels[y * PHASH_SIZE + x]!, 0)),
  );
  const coefficients: number[] = [];
  for (let v = 0; v < PHASH_LOW; v += 1) {
    for (let u = 0; u < PHASH_LOW; u += 1) {
      coefficients.push(DCT[v]!.reduce((sum, c, y) => sum + c * rows[y]![u]!, 0));
    }
  }
  // The DC term (overall brightness) is left out of the median.
  const median = [...coefficients.slice(1)].sort((a, b) => a - b)[31]!;
  let hash = 0n;
  for (const c of coefficients) hash = (hash << 1n) | (c > median ? 1n : 0n);
  return BigInt.asIntN(64, hash);
}

/** Hashes this close are the same photo (re-encoded, resized, lightly cropped or edited). */
export const SAME_PHOTO_DISTANCE = 10;
/** Stricter, for rejecting a photo automatically because it matches a banned one. */
export const BANNED_PHOTO_DISTANCE = 6;

/** Number of differing bits between two hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let v = BigInt.asUintN(64, a ^ b);
  let n = 0;
  while (v) {
    v &= v - 1n;
    n += 1;
  }
  return n;
}
