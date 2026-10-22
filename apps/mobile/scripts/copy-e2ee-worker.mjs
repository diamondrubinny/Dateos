// Copies LiveKit's end-to-end encryption worker into public/, so the web build serves it from this
// origin (the content security policy allows workers only from 'self'). Runs before `expo export`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = dirname(require.resolve('livekit-client')).replace(/\/dist$/, '');
mkdirSync(join(root, 'public'), { recursive: true });
copyFileSync(
  join(pkg, 'dist', 'livekit-client.e2ee.worker.mjs'),
  join(root, 'public', 'livekit-e2ee-worker.mjs'),
);
