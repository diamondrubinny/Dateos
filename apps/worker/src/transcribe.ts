// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_VOICE_SECONDS, type TranscriptLang } from '@nexaheart/shared';

/** Whisper works on 16 kHz mono audio. */
const SAMPLE_RATE = 16_000;

/** Turns one voice clip (our own AAC rendition) into text, on this server. */
export interface Transcriber {
  transcribe(audio: Buffer, lang: TranscriptLang): Promise<string>;
}

/** Decodes our own AAC/MP4 rendition to 16 kHz mono float samples with ffmpeg (no shell). */
export async function decodeForSpeech(
  audio: Buffer,
  ffmpeg = 'ffmpeg',
  timeoutMs = 30_000,
): Promise<Float32Array> {
  const dir = await mkdtemp(join(tmpdir(), 'nexaheart-asr-'));
  try {
    const input = join(dir, 'in.m4a');
    await writeFile(input, audio);
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-protocol_whitelist',
      'file',
      '-f',
      'mov',
      '-i',
      input,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-t',
      String(MAX_VOICE_SECONDS),
      '-f',
      'f32le',
      'pipe:1',
    ];
    const raw = await new Promise<Buffer>((resolve, reject) => {
      execFile(
        ffmpeg,
        args,
        // 2 minutes of 16 kHz float samples is about 7.7 MB.
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });
    // Copy into an aligned buffer: Node may hand back a slice of a shared pool.
    const samples = new Float32Array(Math.floor(raw.length / 4));
    Buffer.from(samples.buffer).set(raw.subarray(0, samples.length * 4));
    return samples;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whisper's names for the app's languages (it would otherwise assume English 📘). */
const WHISPER_LANGUAGE: Record<TranscriptLang, string> = {
  en: 'english',
  he: 'hebrew',
  ar: 'arabic',
  ru: 'russian',
};

type Recognizer = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

/**
 * A local Whisper model through Transformers.js (ONNX Runtime on the CPU). The model is loaded on
 * the first transcript, from `cacheDir` or downloaded once from Hugging Face.
 */
export function createWhisper(options: {
  model: string;
  cacheDir: string;
  ffmpeg?: string;
}): Transcriber {
  let recognizer: Promise<Recognizer> | undefined;
  const load = async (): Promise<Recognizer> => {
    // Imported lazily: the runtime is large and only needed once someone asks for text.
    const { env, pipeline } = await import('@huggingface/transformers');
    env.cacheDir = options.cacheDir;
    const asr = await pipeline('automatic-speech-recognition', options.model, { dtype: 'q8' });
    return asr as unknown as Recognizer;
  };
  return {
    async transcribe(audio, lang) {
      recognizer ??= load().catch((error: unknown) => {
        recognizer = undefined; // try again on the next job (e.g. the download failed)
        throw error;
      });
      const samples = await decodeForSpeech(audio, options.ffmpeg);
      const result = await (
        await recognizer
      )(samples, {
        language: WHISPER_LANGUAGE[lang],
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      return Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text;
    },
  };
}
