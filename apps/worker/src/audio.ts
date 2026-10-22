// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_VOICE_SECONDS } from '@nexaheart/shared';
import { fileTypeFromBuffer } from 'file-type';

/** Accepted voice formats, by magic bytes, and the only ffmpeg demuxer allowed for each. */
const containers: Record<string, 'mov' | 'matroska' | 'ogg'> = {
  'audio/mp4': 'mov',
  'audio/x-m4a': 'mov',
  'video/mp4': 'mov', // Safari's MediaRecorder labels audio-only recordings as MP4
  'audio/webm': 'matroska',
  'video/webm': 'matroska',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
};

export type AudioContainer = (typeof containers)[string];

export class InvalidAudioError extends Error {}

export async function sniffAudio(buffer: Buffer): Promise<AudioContainer | undefined> {
  const detected = await fileTypeFromBuffer(buffer);
  // e.g. "audio/ogg; codecs=opus": only the base type decides.
  return detected ? containers[detected.mime.split(';')[0]!.trim()] : undefined;
}

export type OutputFormat = 'aac' | 'opus';

/**
 * Output: AAC in MP4 (iOS, Android, Safari, Chrome) or Opus in WebM (browsers without AAC),
 * mono, no metadata, hard cut at the maximum length.
 */
export function ffmpegArgs(
  input: string,
  output: string,
  container: AudioContainer,
  format: OutputFormat = 'aac',
): string[] {
  const codec =
    format === 'aac'
      ? ['-ar', '24000', '-c:a', 'aac', '-b:a', '48k']
      : ['-ar', '48000', '-c:a', 'libopus', '-b:a', '32k'];
  const muxer = format === 'aac' ? ['-movflags', '+faststart', '-f', 'mp4'] : ['-f', 'webm'];
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    // Only local files: no network, no concat/pipe tricks from inside the media file.
    '-protocol_whitelist',
    'file',
    '-f',
    container,
    '-i',
    input,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    // Ogg Opus keeps its tags on the stream, which some ffmpeg versions (6.0) copy without this.
    '-map_metadata:s:a',
    '-1',
    '-map_chapters',
    '-1',
    '-ac',
    '1',
    ...codec,
    '-t',
    String(MAX_VOICE_SECONDS),
    '-fs',
    String(1024 * 1024),
    ...muxer,
    '-y',
    output,
  ];
}

function run(binary: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // execFile: no shell, arguments are passed verbatim.
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

export interface TranscodedAudio {
  /** AAC/M4A rendition. */
  data: Buffer;
  /** Opus/WebM rendition. */
  opus: Buffer;
  durationMs: number;
}

export async function transcodeVoice(
  buffer: Buffer,
  options: { ffmpeg?: string | undefined; ffprobe?: string | undefined; timeoutMs?: number } = {},
): Promise<TranscodedAudio> {
  const container = await sniffAudio(buffer);
  if (!container) throw new InvalidAudioError('unsupported_format');
  const dir = await mkdtemp(join(tmpdir(), 'nexaheart-audio-'));
  const input = join(dir, 'in');
  const output = join(dir, 'out.m4a');
  const opusOutput = join(dir, 'out.webm');
  try {
    await writeFile(input, buffer, { mode: 0o600 });
    try {
      const ffmpeg = options.ffmpeg ?? 'ffmpeg';
      const timeout = options.timeoutMs ?? 20_000;
      await run(ffmpeg, ffmpegArgs(input, output, container, 'aac'), timeout);
      await run(ffmpeg, ffmpegArgs(input, opusOutput, container, 'opus'), timeout);
    } catch {
      throw new InvalidAudioError('undecodable');
    }
    const size = (await stat(output).catch(() => null))?.size ?? 0;
    if (size === 0) throw new InvalidAudioError('no_audio');
    const probe = await run(
      options.ffprobe ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output],
      10_000,
    );
    const durationMs = Math.round(Number.parseFloat(probe.trim()) * 1000);
    if (!Number.isFinite(durationMs) || durationMs < 300) throw new InvalidAudioError('too_short');
    return {
      data: await readFile(output),
      opus: await readFile(opusOutput),
      durationMs: Math.min(durationMs, MAX_VOICE_SECONDS * 1000),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
