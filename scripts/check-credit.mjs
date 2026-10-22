// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Checks that the "Powered by NexaHeart" credit and the license notices are in place (phase 17).
 * Keeping them is an additional term of the license (AGPL-3.0 section 7(b), see NOTICE), and CI
 * fails without them. `--fix` adds missing file headers.
 * Usage: node scripts/check-credit.mjs [--fix]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fix = process.argv.includes('--fix');
const SPDX = 'SPDX-License-Identifier: AGPL-3.0-or-later';
const LINES = [
  SPDX,
  'Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com',
  'Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).',
];
const problems = [];

// 1. Every source file starts with the license header.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.endsWith('pnpm-lock.yaml'));

function style(file) {
  const name = basename(file);
  if (/\.(ts|tsx|mjs|cjs|js)$/.test(name)) return 'slash';
  if (/\.(sh|ya?ml)$/.test(name) || name === 'Dockerfile' || name === 'Caddyfile') return 'hash';
  if (name.endsWith('.css')) return 'block';
  if (name.endsWith('.html')) return 'html';
  return null;
}

function header(kind) {
  if (kind === 'slash') return LINES.map((l) => `// ${l}`).join('\n') + '\n';
  if (kind === 'hash') return LINES.map((l) => `# ${l}`).join('\n') + '\n';
  if (kind === 'block') return `/*\n${LINES.map((l) => ` * ${l}`).join('\n')}\n */\n`;
  return `<!--\n${LINES.map((l) => `  ${l}`).join('\n')}\n-->\n`;
}

/** Lines that must stay first: a shebang, a Dockerfile parser directive, an HTML doctype. */
function preamble(text) {
  const first = text.split('\n', 1)[0];
  return /^#!|^# (syntax|escape)=|^<!doctype/i.test(first) ? first.length + 1 : 0;
}

for (const file of files) {
  const kind = style(file);
  if (!kind) continue;
  const path = join(root, file);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  if (text.split('\n').slice(0, 6).join('\n').includes(SPDX)) continue;
  if (fix) {
    const at = preamble(text);
    writeFileSync(path, text.slice(0, at) + header(kind) + text.slice(at));
  } else {
    problems.push(`${file}: missing the license header (run: node scripts/check-credit.mjs --fix)`);
  }
}

// 2. The credit itself, where people see it.
const required = [
  ['packages/shared/src/credit.ts', ["'Powered by NexaHeart'", "'https://nexaheart.com'"]],
  ['apps/mobile/src/components/PoweredBy.tsx', ['creditText(', 'CREDIT_URL']],
  ...[
    'app/welcome.tsx',
    'app/sign-in.tsx',
    'app/check-email.tsx',
    'app/settings.tsx',
    'app/suspended.tsx',
    'app/cookies.tsx',
    'components/LegalPage.tsx',
  ].map((f) => [`apps/mobile/src/${f}`, ['<PoweredBy />']]),
  ['apps/admin/src/App.tsx', ['<PoweredBy locale=', 'CREDIT_URL']],
  ['apps/admin/index.html', ['name="generator" content="NexaHeart']],
  ['apps/mobile/package.json', ['scripts/web-credit.mjs']],
  ['site/build.mjs', ['name="generator" content="NexaHeart']],
  ['site/src/page.html', ['https://nexaheart.com', 'Powered by NexaHeart']],
  ['apps/api/src/lib/mailer.ts', ['creditLine(', 'creditHtml(']],
  ['apps/api/src/lib/credit.ts', ['CREDIT_URL']],
  ['packages/shared/src/checkin-email.ts', ['creditLine(', 'creditHtml(']],
  ['apps/worker/src/privacy-jobs.ts', ['creditLine(']],
  ['LICENSE', ['GNU AFFERO GENERAL PUBLIC LICENSE']],
  ['NOTICE', ['Powered by NexaHeart · Open source', 'https://nexaheart.com', 'section 7(b)']],
];
for (const [file, needles] of required) {
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    problems.push(`${file}: missing`);
    continue;
  }
  for (const needle of needles) {
    if (!text.includes(needle)) problems.push(`${file}: missing ${needle}`);
  }
}

// 3. Every package declares the license.
for (const file of files.filter((f) => basename(f) === 'package.json')) {
  const pkg = JSON.parse(readFileSync(join(root, file), 'utf8'));
  if (pkg.license !== 'AGPL-3.0-or-later') {
    problems.push(`${file}: "license" must be "AGPL-3.0-or-later"`);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `The NexaHeart credit or license notice is missing:\n- ${problems.join('\n- ')}\n`,
  );
  process.exit(1);
}
process.stdout.write('Credit and license notices: OK\n');
