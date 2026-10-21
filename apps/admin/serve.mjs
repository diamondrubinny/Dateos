/* eslint-disable no-console -- startup message of a command-line server */
/**
 * Minimal static server for the built dashboard (`pnpm build && pnpm preview`), with the
 * security headers production should also send (see docs/ADMIN.md for a Caddy example).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(new URL('./dist', import.meta.url).pathname);
const port = Number(process.env.PORT ?? 5174);
const host = process.env.HOST ?? '127.0.0.1';
const apiOrigin = new URL(process.env.VITE_API_URL ?? 'http://localhost:4000').origin;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export const securityHeaders = {
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob: data:",
    `connect-src 'self' ${apiOrigin}`,
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  const isHtml = extname(file) === '.html';
  res.writeHead(200, {
    ...securityHeaders,
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'cache-control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`Moderation dashboard on http://${host}:${port}`);
});
