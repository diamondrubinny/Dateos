// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { TestContext } from './setup.js';

/** Two complete test servers (phase 28): their addresses, and the network between them. */
export const A_URL = 'https://a.example.test';
export const B_URL = 'https://b.example.test';

/** The network between the two test servers: a request to the other address reaches its app. */
export function bridge(origin: string, target: () => TestContext): typeof fetch {
  return (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== origin) throw new Error(`unexpected host ${url.origin}`);
    const res = await target().app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers)),
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    }
    return new Response(res.rawPayload, { status: res.statusCode, headers });
  }) as typeof fetch;
}
