// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { runMigrations } from '@nexaheart/db';
import { creditLine } from '@nexaheart/shared';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createRedis } from './lib/dependencies.js';
import { withDashboardSignIn } from './lib/integrations-boot.js';
import { createServices } from './services.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const loaded = loadEnv();
  if (loaded.MIGRATE_ON_START) await runMigrations(loaded.DATABASE_URL);
  // Sign-in providers saved in the dashboard (phase 24) apply from this start.
  const env = await withDashboardSignIn(loaded);
  const redis = createRedis(env.REDIS_URL);
  await redis.client.connect().catch(() => undefined); // /ready reports the outage instead of crashing.

  let mailErrorHandler: (error: unknown) => void = () => undefined;
  const services = createServices(env, redis.client, (error) => mailErrorHandler(error));
  await services.storage.ensureBuckets().catch(() => undefined); // retried by /ready and uploads.

  const app = await buildApp(env, {
    dependencies: [...services.dependencies, redis],
    redis: redis.client,
    services,
  });
  mailErrorHandler = (error) => app.log.error({ err: error }, 'failed to send email');

  const shutdown = (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    force.unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(creditLine());
}

main().catch((error: unknown) => {
  // EnvValidationError lists key names only; other startup errors (e.g. EADDRINUSE) carry no secrets.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start the API: ${message}\n`);
  process.exit(1);
});
