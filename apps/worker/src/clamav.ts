// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { connect } from 'node:net';

export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface Scanner {
  scan(data: Buffer): Promise<ScanResult>;
}

const CHUNK_SIZE = 64 * 1024;
const TIMEOUT_MS = 30_000;

/** Minimal clamd client using the INSTREAM command (no files are written to disk). */
export function createClamavScanner(host: string, port: number): Scanner {
  return {
    scan(data) {
      return new Promise((resolve, reject) => {
        const socket = connect({ host, port });
        const replies: Buffer[] = [];
        socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('clamd timed out')));
        socket.on('error', reject);
        socket.on('data', (chunk) => replies.push(chunk));
        socket.on('end', () => {
          const reply = Buffer.concat(replies).toString('utf8').replace(/\0/g, '').trim();
          if (reply.endsWith('OK')) return resolve({ clean: true });
          const found = /^stream: (.+) FOUND$/.exec(reply);
          if (found) return resolve({ clean: false, signature: found[1]! });
          reject(new Error(`Unexpected clamd reply: ${reply.slice(0, 120)}`));
        });
        socket.on('connect', () => {
          socket.write('zINSTREAM\0');
          for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
            const chunk = data.subarray(offset, offset + CHUNK_SIZE);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(chunk.length);
            socket.write(size);
            socket.write(chunk);
          }
          socket.end(Buffer.alloc(4)); // zero-length chunk terminates the stream
        });
      });
    },
  };
}

/** Lite mode: no scanning. Callers must log that the file was not scanned. */
export const noopScanner: Scanner = { scan: async () => ({ clean: true }) };
