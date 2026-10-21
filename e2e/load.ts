/**
 * Load test: discovery and chat with a realistic data set, on a separate database.
 *
 *   1. node --env-file=../.env --import tsx load.ts seed     (creates `<db>_load` with MEMBERS members)
 *   2. start an API on that database (see docs/PERFORMANCE.md)
 *   3. API_URL=http://localhost:4200 node --env-file=../.env --import tsx load.ts run
 *
 * Requests are paced per member below the per-member limits, so latencies are measured without 429s.
 */
import { createDb, runMigrations } from '@dateos/db';
import { EMBEDDING_DIM, SENSITIVE_CONSENT_VERSION } from '@dateos/shared';
import { API, signInHttp, WEB } from './lib.ts';

const MEMBERS = Number(process.env.MEMBERS ?? 5000);
const VIEWERS = Number(process.env.VIEWERS ?? 60);
const SECONDS = Number(process.env.SECONDS ?? 30);

function loadDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.endsWith('_load')) url.pathname = `${url.pathname}_load`;
  return url.toString();
}

async function ensureDatabase(url: string) {
  const admin = new URL(url);
  const name = admin.pathname.slice(1);
  admin.pathname = '/postgres';
  const { pool } = createDb(admin.toString(), { max: 1 });
  try {
    const exists = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await pool.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await pool.end();
  }
}

async function seed() {
  const url = loadDatabaseUrl();
  await ensureDatabase(url);
  await runMigrations(url);
  const { pool } = createDb(url, { max: 2 });
  try {
    const t0 = Date.now();
    await pool.query('TRUNCATE "user" CASCADE');
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified)
       SELECT 'load-' || n, '', 'load-' || n || '@load.test', true FROM generate_series(1, $1) n`,
      [MEMBERS],
    );
    // Women and men in equal numbers, 10% interested in everyone, ages 20–45, ~25 km around Tel Aviv.
    await pool.query(
      `INSERT INTO profiles (user_id, display_name, birth_date, gender, interested_in, intention, bio, languages)
       SELECT 'load-' || n, 'Member ' || n,
              date '1981-01-01' + ((n * 37) % 9000),
              (CASE WHEN n % 2 = 0 THEN 'woman' ELSE 'man' END)::gender,
              CASE WHEN n % 10 = 0 THEN ARRAY['woman','man']::gender[]
                   WHEN n % 2 = 0 THEN ARRAY['man']::gender[] ELSE ARRAY['woman']::gender[] END,
              (ARRAY['long_term','short_term','open','unsure'])[1 + n % 4]::intention,
              'Coffee, the sea and live music ' || n, ARRAY['he','en']
       FROM generate_series(1, $1) n`,
      [MEMBERS],
    );
    await pool.query(
      `INSERT INTO preferences (user_id, age_min, age_max, max_distance_km)
       SELECT 'load-' || n, 18, 60, 50 FROM generate_series(1, $1) n`,
      [MEMBERS],
    );
    await pool.query(
      `INSERT INTO locations (user_id, geo)
       SELECT 'load-' || n, ST_SetSRID(ST_MakePoint(34.78 + (random() - 0.5) * 0.5, 32.08 + (random() - 0.5) * 0.45), 4326)::geography
       FROM generate_series(1, $1) n`,
      [MEMBERS],
    );
    await pool.query(
      `INSERT INTO photos (user_id, status, purpose, media_key, width, height, position)
       SELECT 'load-' || n, 'clean', 'profile', 'load/' || n || '.webp', 800, 1000, 0 FROM generate_series(1, $1) n`,
      [MEMBERS],
    );
    await pool.query(
      `INSERT INTO prompts (user_id, prompt_key, answer, position)
       SELECT 'load-' || n, 'perfect_sunday', 'Jaffa flea market, then hummus ' || n, 0 FROM generate_series(1, $1) n`,
      [MEMBERS],
    );
    await pool.query(
      `INSERT INTO consents (user_id, kind, granted, version)
       SELECT 'load-' || n, k.kind::consent_kind, true, k.version
       FROM generate_series(1, $1) n,
            (VALUES ('terms', $2), ('privacy', $3), ('sensitive', $4), ('location', '1')) AS k(kind, version)`,
      [
        MEMBERS,
        process.env.TERMS_VERSION ?? '2026-10',
        process.env.PRIVACY_VERSION ?? '2026-10',
        SENSITIVE_CONSENT_VERSION,
      ],
    );
    await pool.query(
      `INSERT INTO profile_embeddings (user_id, embedding, model)
       SELECT 'load-' || n, (SELECT array_agg(random() - 0.5) FROM generate_series(1, $2) d WHERE n > 0)::vector, 'hashing-v1'
       FROM generate_series(1, $1) n`,
      [MEMBERS, EMBEDDING_DIM],
    );
    // About 20 likes per member, mostly towards the gender they're interested in.
    await pool.query(
      `INSERT INTO interactions (actor_id, target_id, kind)
       SELECT DISTINCT ON (a, b) 'load-' || a, 'load-' || b, 'like'::interaction_kind
       FROM (SELECT n AS a, 1 + ((n + 1 + 2 * floor(random() * ($1 / 2 - 1)))::int % $1) AS b
             FROM generate_series(1, $1) n, generate_series(1, 20)) x
       WHERE a <> b`,
      [MEMBERS],
    );
    await pool.query('ANALYZE');
    const counts = await pool.query(
      `SELECT (SELECT count(*) FROM "user")::int AS users, (SELECT count(*) FROM interactions)::int AS likes`,
    );
    process.stdout.write(
      `seeded ${JSON.stringify(counts.rows[0])} in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`,
    );
  } finally {
    await pool.end();
  }
}

function stats(name: string, ms: number[], statuses: Map<number, number>, seconds: number) {
  const sorted = [...ms].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const codes = [...statuses].map(([c, n]) => `${c}×${n}`).join(' ');
  process.stdout.write(
    `${name}: ${sorted.length} requests, ${(sorted.length / seconds).toFixed(1)} req/s, ` +
      `p50 ${q(0.5).toFixed(0)} ms, p95 ${q(0.95).toFixed(0)} ms, p99 ${q(0.99).toFixed(0)} ms, max ${q(1).toFixed(0)} ms [${codes}]\n`,
  );
  return { p95: q(0.95), ok: (statuses.get(200) ?? 0) + (statuses.get(201) ?? 0) };
}

/** Each member sends one request every `everyMs`, for SECONDS. */
async function paced(
  members: { cookie: string }[],
  everyMs: number,
  request: (m: { cookie: string }, i: number) => Promise<Response>,
) {
  const ms: number[] = [];
  const statuses = new Map<number, number>();
  const end = Date.now() + SECONDS * 1000;
  await Promise.all(
    members.map(async (m, idx) => {
      await new Promise((r) => setTimeout(r, (idx * everyMs) / members.length)); // spread the start
      let i = 0;
      while (Date.now() < end) {
        const t = performance.now();
        const res = await request(m, i++);
        await res.arrayBuffer();
        ms.push(performance.now() - t);
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, Math.max(0, everyMs - (performance.now() - t))));
      }
    }),
  );
  return { ms, statuses };
}

async function run() {
  const url = loadDatabaseUrl();
  const { pool } = createDb(url, { max: 2 });
  const viewers: { id: string; cookie: string }[] = [];
  const pairs: { matchId: string; a: (typeof viewers)[0]; b: (typeof viewers)[0] }[] = [];
  try {
    for (let n = 1; n <= VIEWERS; n += 1) {
      const s = await signInHttp(`load-${n}@load.test`);
      viewers.push({ id: `load-${n}`, cookie: s.header });
    }
    // Matches between consecutive viewers (n odd ↔ n+1) for the chat test.
    for (let i = 0; i + 1 < viewers.length; i += 2) {
      const [a, b] = [viewers[i]!, viewers[i + 1]!];
      const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      const row = await pool.query(
        `INSERT INTO matches (user_a, user_b) VALUES ($1, $2)
         ON CONFLICT (user_a, user_b) DO UPDATE SET unmatched_at = NULL RETURNING id`,
        [x, y],
      );
      pairs.push({ matchId: row.rows[0].id, a, b });
    }
    await pool.query(`DELETE FROM impressions; DELETE FROM daily_picks;`);
  } finally {
    await pool.end();
  }
  const headers = (cookie: string) => ({ cookie, origin: WEB });

  process.stdout.write(
    `${VIEWERS} members signed in, ${MEMBERS} in the database, ${SECONDS} s per test\n`,
  );
  // Below the 30/min per-member limit on discovery: one request every 2.5 s each.
  const discover = await paced(viewers, 2500, (m) =>
    fetch(`${API}/v1/discover?limit=10`, { headers: headers(m.cookie) }),
  );
  const d = stats('GET /v1/discover', discover.ms, discover.statuses, SECONDS);

  const senders = pairs.flatMap((p) => [
    { cookie: p.a.cookie, matchId: p.matchId },
    { cookie: p.b.cookie, matchId: p.matchId },
  ]);
  const chat = await paced(senders, 2500, (m, i) =>
    fetch(`${API}/v1/matches/${(m as (typeof senders)[0]).matchId}/messages`, {
      method: 'POST',
      headers: { ...headers(m.cookie), 'content-type': 'application/json' },
      body: JSON.stringify({ text: `Load message ${i}`, clientId: crypto.randomUUID() }),
    }),
  );
  const c = stats('POST /v1/matches/:id/messages', chat.ms, chat.statuses, SECONDS);

  const inbox = await paced(viewers, 2500, (m) =>
    fetch(`${API}/v1/matches`, { headers: headers(m.cookie) }),
  );
  stats('GET /v1/matches', inbox.ms, inbox.statuses, SECONDS);

  const failed = d.p95 >= 300 || c.p95 >= 100 || d.ok === 0 || c.ok === 0;
  process.stdout.write(
    failed ? 'targets missed\n' : 'targets met (discover p95 < 300 ms, send p95 < 100 ms)\n',
  );
  if (failed) process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === 'seed') await seed();
else if (mode === 'run') await run();
else {
  process.stderr.write('usage: load.ts seed | run\n');
  process.exitCode = 2;
}
