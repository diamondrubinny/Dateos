// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createDb(databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  runMigrations(url).then(
    () => process.stdout.write('Migrations applied\n'),
    (error: unknown) => {
      process.stderr.write(
        `Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
