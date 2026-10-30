// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 63: a PRETEND age-check provider, for local tests only. It asks nothing and checks nothing:
 * the tester picks the result, and it sends it to the community signed the way a real provider (or
 * its bridge) must: HMAC-SHA256 of "session.result.method.ts" with AGE_CHECK_SECRET, hex, in the
 * x-nexaheart-signature header. Never run it in production.
 * Usage: AGE_CHECK_SECRET=… node fake-age-provider.mjs   (listens on :8090, /check)
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const secret = process.env.AGE_CHECK_SECRET;
if (!secret || secret.length < 32) {
  process.stderr.write('Set AGE_CHECK_SECRET (32+ characters), the same as the API’s.\n');
  process.exit(1);
}
const port = Number(process.env.FAKE_AGE_PORT ?? 8090);
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (req.method === 'GET' && url.pathname === '/check') {
    const session = url.searchParams.get('session') ?? '';
    const back = url.searchParams.get('return') ?? '';
    const callback = url.searchParams.get('callback') ?? '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pretend age check</title></head>
<body style="font-family:sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem">
<main><h1>Pretend age check (tests only)</h1>
<p>A real provider would check here. Choose the result to send back.</p>
<form method="post" action="/confirm">
<input type="hidden" name="session" value="${escape(session)}">
<input type="hidden" name="return" value="${escape(back)}">
<input type="hidden" name="callback" value="${escape(callback)}">
<button name="result" value="over_18">Over 18</button>
<button name="result" value="under_18">Under 18</button>
<button name="result" value="failed">Couldn’t check</button>
</form></main></body></html>`);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/confirm') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    const body = {
      session: form.get('session'),
      result: form.get('result'),
      method: 'pretend',
      ts: Math.floor(Date.now() / 1000),
    };
    const signature = createHmac('sha256', secret)
      .update(`${body.session}.${body.result}.${body.method}.${body.ts}`)
      .digest('hex');
    const sent = await fetch(form.get('callback') ?? '', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nexaheart-signature': signature },
      body: JSON.stringify(body),
    });
    res.writeHead(303, { location: sent.ok ? (form.get('return') ?? '/') : '/check?error=1' });
    res.end();
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => process.stdout.write(`Pretend age-check provider on :${port}\n`));
