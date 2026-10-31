// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * A stand-in for a local Ollama model (phase 75b e2e): answers questions about hiking from a
 * script, "NOT_IN_PROFILE" otherwise. Nothing leaves the machine.
 * Usage: node fake-model.mjs [port]  (then ICEBREAKERS_PROVIDER=ollama OLLAMA_URL=http://localhost:PORT)
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 11555);
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let content = 'NOT_IN_PROFILE';
    try {
      const { messages } = JSON.parse(body);
      const system = messages[0]?.content ?? '';
      const user = messages[1]?.content ?? '';
      const question = user.split('\nQuestion:')[1] ?? '';
      const hebrew = system.includes('Hebrew');
      if (/hik|טיול/i.test(question) && /hik/i.test(user.split('\nQuestion:')[0] ?? '')) {
        content = hebrew
          ? 'כן, הם אוהבים טיולים בסופי שבוע.'
          : 'Yes, they love hiking on weekends.';
      }
    } catch {
      // Malformed: answer that the profile doesn't say.
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: { role: 'assistant', content } }));
  });
}).listen(port, '127.0.0.1');
