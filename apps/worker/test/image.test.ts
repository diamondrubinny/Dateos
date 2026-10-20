import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { InvalidImageError, MAX_DIMENSION, processImage } from '../src/image.js';

async function jpegWithGps(width = 640, height = 480): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#7c3aed' } })
    .withExif({
      IFD0: { Make: 'PrivacyTestCam', Model: 'X1' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '32/1 4/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '34/1 46/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
}

describe('processImage', () => {
  it('strips EXIF (including GPS) and re-encodes to WebP', async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really has EXIF

    const out = await processImage(input);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(out.data.includes(Buffer.from('PrivacyTestCam'))).toBe(false);
  });

  it('applies EXIF orientation to the pixels before dropping it', async () => {
    const rotated = await sharp({
      create: { width: 600, height: 300, channels: 3, background: '#000' },
    })
      .withMetadata({ orientation: 6 }) // 6 = rotate 90° clockwise
      .jpeg()
      .toBuffer();
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    const out = await processImage(rotated);
    expect([out.width, out.height]).toEqual([300, 600]);
  });

  it(`downscales to at most ${MAX_DIMENSION}px and never upscales`, async () => {
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    const large = await processImage(big);
    expect(Math.max(large.width, large.height)).toBe(MAX_DIMENSION);

    const small = await processImage(await jpegWithGps(200, 100));
    expect([small.width, small.height]).toEqual([200, 100]);
  });

  it('rejects non-images and files disguised as images', async () => {
    await expect(processImage(Buffer.from('%PDF-1.7 not an image'))).rejects.toBeInstanceOf(
      InvalidImageError,
    );
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
      .gif()
      .toBuffer();
    await expect(processImage(gif)).rejects.toThrow('unsupported_type');
  });

  it('rejects decompression bombs', async () => {
    const bomb = await sharp({
      create: { width: 10_000, height: 10_000, channels: 3, background: '#fff' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(processImage(bomb)).rejects.toThrow('invalid_image');
  });

  it('rejects truncated images', async () => {
    const input = await jpegWithGps();
    await expect(processImage(input.subarray(0, input.length / 2))).rejects.toThrow(
      'invalid_image',
    );
  });
});
