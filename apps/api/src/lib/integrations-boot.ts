// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createDb } from '@nexaheart/db';
import { IntegrationStore, parseIntegrationsKey } from '@nexaheart/integrations';
import type { Env } from '../config/env.js';

/**
 * Sign-in providers are set up once, when the API starts (phase 24): those saved in the dashboard
 * are read here. The server's own environment variables still win.
 */
export async function withDashboardSignIn(env: Env): Promise<Env> {
  const { db, pool } = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const store = new IntegrationStore(db, parseIntegrationsKey(env.INTEGRATIONS_KEY));
    const next = { ...env };
    for (const id of ['google', 'apple'] as const) {
      const cfg = await store.get(id);
      const clientId = cfg.settings.clientId;
      const clientSecret = cfg.secrets.clientSecret;
      if (cfg.source !== 'dashboard' || !cfg.enabled) continue;
      if (typeof clientId !== 'string' || !clientId || !clientSecret) continue;
      if (id === 'google') {
        next.GOOGLE_CLIENT_ID = clientId;
        next.GOOGLE_CLIENT_SECRET = clientSecret;
      } else {
        next.APPLE_CLIENT_ID = clientId;
        next.APPLE_CLIENT_SECRET = clientSecret;
      }
    }
    return next;
  } catch {
    // Without the database (or the table) the API still starts with its own settings.
    return env;
  } finally {
    await pool.end();
  }
}
