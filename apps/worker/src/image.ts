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
