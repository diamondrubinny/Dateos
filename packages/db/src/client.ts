import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
}

export function createDb(databaseUrl: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
  });
  // Without a listener, an idle-client error would crash the process.
  pool.on('error', () => undefined);
  return { db: drizzle(pool, { schema }), pool };
}
