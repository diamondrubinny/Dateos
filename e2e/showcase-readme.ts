// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Rebuilds the README's and marketing pages' showcase images (phase 58) from the screenshots the
 * e2e runs already took. No screen is drawn by hand: run the feature's e2e first to refresh one.
 * Usage: pnpm --dir e2e showcase-readme
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { OUT, showcase } from './lib.ts';

/** Phone screens, side by side (see showcase in lib.ts). */
const strips: Record<string, string[]> = {
  // Everyday chat: pinned chats and drafts, reactions, replies, quiet hours, add to calendar.
  everyday: [
    '110-pinned-draft',
    '98-reactions',
    '99-reply',
    '111-quiet-hours',
    '115-calendar-date',
  ],
  // You, as others see you; accessibility needs and easy mode.
  profile: [
    '117-preview',
    '107-profile-strength',
    '112-photo-description',
    '94-display',
    '95-discover-easy',
  ],
  // Dates: suggest another time, running late, after the date.
  dates: ['120-date-counter', '121-date-countered', '119-checkin-late', '72-date-feedback'],
  // Communities that connect.
  partners: ['102-partners-join', '103-partners-deck', '104-partners-match', '105-partners-chat'],
  // Dark mode, and the app when the server or the connection is away.
  resilience: ['122-dark-chat', '123-dark-checkin', '132-server-banner', '137-pwa-offline'],
};

/** Dashboard screens (wide), two by two. */
async function grid(file: string, screens: string[]) {
  const present = screens.filter((s) => existsSync(join(OUT, `${s}.png`)));
  if (present.length === 0) return;
  const width = 760;
  const gap = 28;
  const tiles = await Promise.all(
    present.map((s) =>
      sharp(join(OUT, `${s}.png`))
        .resize({ width, height: Math.round(width * 0.62), fit: 'cover', position: 'top' })
        .png()
        .toBuffer({ resolveWithObject: true }),
    ),
  );
  const h = tiles[0]!.info.height;
  const cols = 2;
  const rows = Math.ceil(tiles.length / cols);
  const out = await sharp({
    create: {
      width: cols * width + (cols + 1) * gap,
      height: rows * h + (rows + 1) * gap,
      channels: 4,
      background: '#EDE5FF',
    },
  })
    .composite(
      tiles.map((t, i) => ({
        input: t.data,
        left: gap + (i % cols) * (width + gap),
        top: gap + Math.floor(i / cols) * (h + gap),
      })),
    )
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeFileSync(join(OUT, `${file}.png`), out);
  process.stdout.write(`  ✓ ${file}.png\n`);
}

for (const locale of ['en', 'he'] as const) {
  for (const [name, screens] of Object.entries(strips)) {
    await showcase(
      `showcase-${name}-${locale}`,
      screens.map((s) => `${locale}/${s}`),
    );
  }
  await grid(`showcase-admin-ops-${locale}`, [
    `${locale}/126-admin-system-no-backup`,
    `${locale}/127-admin-update-available`,
    `${locale}/134-admin-update-schedule`,
    `${locale}/136-admin-update-history`,
  ]);
}
