// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
// Minimal static server for the exported web app (SPA fallback to index.html). Dev/e2e use only.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '../apps/mobile/dist');
const port = Number(process.env.PORT ?? 8081);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};
// Phase 57: as Caddy does in production, the manifest comes from the API's branding.
const api = process.env.API_URL ?? 'http://localhost:4000';

createServer((req, res) => {
  if (req.url === '/manifest.webmanifest') {
    fetch(`${api}/v1/instance/manifest.webmanifest`)
      .then(async (r) => {
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/plain' });
        res.end(Buffer.from(await r.arrayBuffer()));
      })
      .catch(() => res.writeHead(502).end());
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  let file = join(root, path);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    ...(file.endsWith('sw.js') || file.endsWith('index.html')
      ? { 'cache-control': 'no-cache' }
      : {}),
  });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () =>
  process.stdout.write(`Serving ${root} on http://localhost:${port}\n`),
);
