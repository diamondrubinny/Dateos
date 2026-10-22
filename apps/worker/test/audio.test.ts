import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegArgs, InvalidAudioError, sniffAudio, transcodeVoice } from '../src/audio.js';

/** Real recordings in the formats phones and browsers produce, generated with ffmpeg. */
function tone(seconds: number, args: string[], ext: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'audio-test-'));
  const out = join(dir, `t.${ext}`);
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    ...args,
    '-metadata',
    'title=SECRET-TITLE',
    '-y',
    out,
  ]);
  return readFileSync(out);
}

// Real ffmpeg runs take 1–2 s each on an idle machine; with every package's tests running at once they
// can pass vitest's 5 s default, so these get room for real work.
describe('voice message pipeline (real ffmpeg)', { timeout: 30_000 }, () => {
  it('accepts WebM/Opus (Chrome), Ogg (Firefox) and M4A (iOS/Android) and outputs clean M4A', async () => {
    for (const [args, ext] of [
      [['-c:a', 'libopus'], 'webm'],
      [['-c:a', 'libopus'], 'ogg'],
      [['-c:a', 'aac'], 'm4a'],
    ] as const) {
      const result = await transcodeVoice(tone(3, [...args], ext));
      expect(result.durationMs, ext).toBeGreaterThan(2800);
      expect(result.durationMs, ext).toBeLessThan(3300);
      expect(await sniffAudio(result.data), ext).toBe('mov');
      expect(await sniffAudio(result.opus), ext).toBe('matroska');
      expect(
        result.opus.includes(Buffer.from('SECRET-TITLE')),
        `${ext} opus metadata stripped`,
      ).toBe(false);
      expect(result.data.includes(Buffer.from('SECRET-TITLE')), `${ext} metadata stripped`).toBe(
        false,
      );
    }
  });

  it('cuts recordings at 60 seconds', async () => {
    const result = await transcodeVoice(tone(75, ['-c:a', 'libopus', '-b:a', '16k'], 'webm'));
    expect(result.durationMs).toBeLessThanOrEqual(60_000);
    expect(result.durationMs).toBeGreaterThan(59_000);
  });

  it('rejects files that are not audio or cannot be decoded', async () => {
    await expect(transcodeVoice(Buffer.from('not audio at all, just text'))).rejects.toBeInstanceOf(
      InvalidAudioError,
    );
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    await expect(transcodeVoice(png)).rejects.toBeInstanceOf(InvalidAudioError);
    const broken = tone(2, ['-c:a', 'libopus'], 'webm').subarray(0, 200); // valid header, garbage after
    await expect(transcodeVoice(broken)).rejects.toBeInstanceOf(InvalidAudioError);
  });

  it('never lets ffmpeg open network or other protocols', () => {
    const args = ffmpegArgs('/tmp/in', '/tmp/out.m4a', 'matroska');
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file');
    expect(args[args.indexOf('-f') + 1]).toBe('matroska');
    expect(args).toContain('-map_metadata');
  });
});
