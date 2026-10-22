import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createClamavScanner } from '../src/clamav.js';

let server: Server | undefined;

afterEach(
  () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

/** Fake clamd that parses INSTREAM framing and replies based on the payload. */
function fakeClamd(reply: (payload: Buffer) => string): Promise<number> {
  server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const command = 'zINSTREAM\0';
      if (buffer.length < command.length) return;
      let offset = command.length;
      const parts: Buffer[] = [];
      while (offset + 4 <= buffer.length) {
        const size = buffer.readUInt32BE(offset);
        if (size === 0) {
          socket.end(`stream: ${reply(Buffer.concat(parts))}\0`);
          return;
        }
        if (offset + 4 + size > buffer.length) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  return new Promise((resolve) =>
    server!.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port)),
  );
}

describe('clamav scanner', () => {
  it('reports clean files and streams the full payload in chunks', async () => {
    let received = 0;
    const port = await fakeClamd((payload) => {
      received = payload.length;
      return 'OK';
    });
    const data = Buffer.alloc(200_000, 7); // several 64 KiB chunks
    await expect(createClamavScanner('127.0.0.1', port).scan(data)).resolves.toEqual({
      clean: true,
    });
    expect(received).toBe(data.length);
  });

  it('reports infected files with the signature name', async () => {
    const port = await fakeClamd(() => 'Eicar-Test-Signature FOUND');
    await expect(createClamavScanner('127.0.0.1', port).scan(Buffer.from('x'))).resolves.toEqual({
      clean: false,
      signature: 'Eicar-Test-Signature',
    });
  });

  it('fails closed on unexpected replies and connection errors', async () => {
    const port = await fakeClamd(() => 'INSTREAM size limit exceeded. ERROR');
    await expect(createClamavScanner('127.0.0.1', port).scan(Buffer.from('x'))).rejects.toThrow(
      'Unexpected clamd reply',
    );
    await expect(createClamavScanner('127.0.0.1', 1).scan(Buffer.from('x'))).rejects.toThrow();
  });
});
