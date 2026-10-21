/**
 * Demo data for local development and screenshots: fictional people with illustrated
 * (non-photographic) avatars around Tel Aviv. Refuses to run in production.
 *   pnpm --filter @dateos/e2e seed            # create demo members
 *   pnpm --filter @dateos/e2e seed -- --reset # remove them first
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { hashingProvider, profileText } from '@dateos/ai';
import { createDb, schema } from '@dateos/db';
import { snapToGrid, type Gender, type Intention, type PromptKey } from '@dateos/shared';
import { createStorage, mediaKey } from '@dateos/storage';
import { eq, inArray, like, sql } from 'drizzle-orm';
import sharp from 'sharp';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const DEMO_EMAIL_DOMAIN = 'demo.dateos.invalid';
const CENTER = { lat: 32.0853, lng: 34.7818 }; // Tel Aviv

interface Person {
  name: string;
  gender: Gender;
  interestedIn: Gender[];
  age: number;
  intention: Intention;
  languages: string[];
  bio: string;
  prompts: [PromptKey, string][];
  palette: [string, string, string]; // background, skin, hair
}

const people: Person[] = [
  {
    name: 'Daniel',
    gender: 'man',
    interestedIn: ['woman'],
    age: 31,
    intention: 'long_term',
    languages: ['he', 'en'],
    bio: 'Product designer, weekend surfer and hummus purist. Looking for someone to explore new trails with.',
    prompts: [
      ['perfect_sunday', 'Sunrise surf session, shakshuka, then a long nap.'],
      ['green_flag', 'You ask good questions and actually listen.'],
    ],
    palette: ['#c7d2fe', '#e0b48f', '#3f2a1d'],
  },
  {
    name: 'Yoav',
    gender: 'man',
    interestedIn: ['woman'],
    age: 29,
    intention: 'long_term',
    languages: ['he', 'en'],
    bio: 'Architect who sketches buildings in cafés. Amateur baker, terrible singer, great listener.',
    prompts: [
      ['first_date_idea', 'Coffee in Neve Tzedek and a walk to the old port.'],
      ['geek_out_about', 'Bauhaus buildings and sourdough hydration ratios.'],
    ],
    palette: ['#fde68a', '#d9a27b', '#1f2937'],
  },
  {
    name: 'Amit',
    gender: 'man',
    interestedIn: ['woman'],
    age: 33,
    intention: 'open',
    languages: ['he'],
    bio: 'מורה למוזיקה, מנגן בגיטרה בסופי שבוע ואוהב טיולים בצפון.',
    prompts: [
      ['simple_pleasures', 'קפה שחור על המרפסת וגיטרה בשקיעה.'],
      ['looking_for', 'אוהבת לצחוק ולא לוקחת את עצמה יותר מדי ברצינות.'],
    ],
    palette: ['#bbf7d0', '#c68863', '#111827'],
  },
  {
    name: 'Omer',
    gender: 'man',
    interestedIn: ['woman'],
    age: 27,
    intention: 'short_term',
    languages: ['he', 'en'],
    bio: 'Software engineer by day, climber by night. Always up for a spontaneous road trip.',
    prompts: [
      ['best_travel_story', 'Got lost in Lisbon and ended up at a stranger’s wedding.'],
      ['two_truths_one_lie', 'I speak four languages, I climbed Kilimanjaro, I hate chocolate.'],
    ],
    palette: ['#fecaca', '#f1c7a5', '#7c2d12'],
  },
  {
    name: 'Itai',
    gender: 'man',
    interestedIn: ['woman'],
    age: 35,
    intention: 'long_term',
    languages: ['he', 'en'],
    bio: 'Doctor, dog dad and home cook. I believe the best conversations happen over long dinners.',
    prompts: [
      ['green_flag', 'Kindness to strangers, waiters and dogs.'],
      ['perfect_sunday', 'Farmers market, cooking for friends, a movie on the couch.'],
    ],
    palette: ['#ddd6fe', '#e8b994', '#4b5563'],
  },
  {
    name: 'Noam',
    gender: 'man',
    interestedIn: ['woman', 'man'],
    age: 30,
    intention: 'unsure',
    languages: ['en'],
    bio: 'Recently moved to Tel Aviv from Toronto. Learning Hebrew one falafel at a time.',
    prompts: [
      ['geek_out_about', 'Board games, especially the ones that ruin friendships.'],
      ['first_date_idea', 'A board game bar and a slice of pizza after.'],
    ],
    palette: ['#a5f3fc', '#f5d0b5', '#a16207'],
  },
  {
    name: 'Lior',
    gender: 'nonbinary',
    interestedIn: ['woman', 'man', 'nonbinary'],
    age: 28,
    intention: 'open',
    languages: ['he', 'en'],
    bio: 'Illustrator and plant collector. My apartment is 60% monstera.',
    prompts: [
      ['simple_pleasures', 'Fresh pages in a new sketchbook.'],
      ['green_flag', 'You have a favourite tree and can tell me why.'],
    ],
    palette: ['#fbcfe8', '#c58c6d', '#065f46'],
  },
  {
    name: 'Shira',
    gender: 'woman',
    interestedIn: ['man'],
    age: 29,
    intention: 'long_term',
    languages: ['he', 'en'],
    bio: 'Marine biologist who will tell you everything about octopuses. Sunset swims are my therapy.',
    prompts: [
      ['geek_out_about', 'Octopuses. They have three hearts!'],
      ['perfect_sunday', 'Swim at Gordon beach, then brunch with my sisters.'],
    ],
    palette: ['#bae6fd', '#e9b892', '#1c1917'],
  },
  {
    name: 'Tamar',
    gender: 'woman',
    interestedIn: ['man'],
    age: 32,
    intention: 'long_term',
    languages: ['he'],
    bio: 'עורכת דין ביום, רקדנית סלסה בלילה. מחפשת שותף לריקוד ולחיים.',
    prompts: [
      ['first_date_idea', 'שיעור סלסה ואחריו גלידה בשדרה.'],
      ['green_flag', 'מישהו שמתקשר כשהוא אומר שיתקשר.'],
    ],
    palette: ['#fed7aa', '#d29b74', '#292524'],
  },
  {
    name: 'Noa',
    gender: 'woman',
    interestedIn: ['man', 'woman'],
    age: 27,
    intention: 'open',
    languages: ['he', 'en'],
    bio: 'UX researcher, podcast addict and cat person. Ask me about my cat’s Instagram.',
    prompts: [
      ['two_truths_one_lie', 'I ran a marathon, I met Obama, I can juggle.'],
      ['simple_pleasures', 'Rainy days, tea and a good podcast.'],
    ],
    palette: ['#e9d5ff', '#f3cfb3', '#78350f'],
  },
  {
    name: 'Yael',
    gender: 'woman',
    interestedIn: ['man'],
    age: 34,
    intention: 'long_term',
    languages: ['he', 'en'],
    bio: 'Teacher, traveller and amateur photographer. I’ve visited 30 countries and counting.',
    prompts: [
      ['best_travel_story', 'Watched the northern lights from a frozen lake in Finland.'],
      ['looking_for', 'Someone curious who loves planning the next adventure.'],
    ],
    palette: ['#99f6e4', '#cf9a78', '#3b0764'],
  },
];

/** Illustrated avatar: a stylised silhouette, clearly not a photo of a real person. */
async function avatar(p: Person, variant: number): Promise<Buffer> {
  const [bg, skin, hair] = p.palette;
  const long = p.gender === 'woman' || variant % 2 === 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
    <rect width="1080" height="1350" fill="url(#g)"/>
    <circle cx="${variant === 2 ? 860 : 220}" cy="${variant === 1 ? 1150 : 230}" r="${120 + variant * 30}" fill="#ffffff" opacity="0.45"/>
    ${long ? `<path d="M330 560 Q540 260 750 560 L790 960 L290 960 Z" fill="${hair}"/>` : ''}
    <rect x="300" y="900" width="480" height="500" rx="200" fill="#6d28d9" opacity="${0.75 + variant * 0.08}"/>
    <rect x="490" y="760" width="100" height="170" rx="40" fill="${skin}"/>
    <ellipse cx="540" cy="600" rx="190" ry="220" fill="${skin}"/>
    <path d="M350 560 Q540 300 730 560 Q700 420 540 390 Q380 420 350 560 Z" fill="${hair}"/>
    <circle cx="470" cy="620" r="14" fill="#1f2937"/><circle cx="610" cy="620" r="14" fill="#1f2937"/>
    <path d="M480 700 Q540 750 600 700" stroke="#9f1239" stroke-width="12" fill="none" stroke-linecap="round"/>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
}

function birthDate(age: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age, 2, 15);
  return d.toISOString().slice(0, 10);
}

export async function seedDemo({ reset = false } = {}): Promise<string[]> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to seed demo data in production');
  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url))
    throw new Error('Demo seed only runs against a local database');

  const { db, pool } = createDb(url);
  const storage = createStorage({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    quarantineBucket: process.env.S3_BUCKET_QUARANTINE ?? 'dateos-quarantine',
    mediaBucket: process.env.S3_BUCKET_MEDIA ?? 'dateos-media',
  });
  await storage.ensureBuckets();
  try {
    if (reset) {
      const old = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(like(schema.user.email, `%@${DEMO_EMAIL_DOMAIN}`));
      if (old.length > 0) {
        for (const { id } of old)
          await storage.delete(
            storage.buckets.media,
            await storage.listKeys(storage.buckets.media, `photos/${id}/`),
          );
        await db.delete(schema.user).where(
          inArray(
            schema.user.id,
            old.map((o) => o.id),
          ),
        );
      }
    }
    const ids: string[] = [];
    for (const [i, p] of people.entries()) {
      const email = `${p.name.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`;
      const [existing] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email));
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const id = `demo${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      ids.push(id);
      await db.insert(schema.user).values({ id, email, name: p.name, emailVerified: true });
      await db.insert(schema.profiles).values({
        userId: id,
        displayName: p.name,
        birthDate: birthDate(p.age),
        gender: p.gender,
        interestedIn: p.interestedIn,
        intention: p.intention,
        bio: p.bio,
        languages: p.languages,
      });
      await db
        .insert(schema.preferences)
        .values({ userId: id, ageMin: 22, ageMax: 45, maxDistanceKm: 50, intentions: [] });
      await db.insert(schema.prompts).values(
        p.prompts.map(([promptKey, answer], position) => ({
          userId: id,
          promptKey,
          answer,
          position,
        })),
      );
      await db.insert(schema.consents).values(
        (['terms', 'privacy', 'location'] as const).map((kind) => ({
          userId: id,
          kind,
          granted: true,
          version: kind === 'location' ? '1' : '2026-10',
        })),
      );
      // Spread members over ~12 km around the centre (stored as snapped cells only).
      const angle = (i / people.length) * 2 * Math.PI;
      const km = 1 + (i % 4) * 3;
      const cell = snapToGrid(
        CENTER.lat + (Math.sin(angle) * km) / 111,
        CENTER.lng + (Math.cos(angle) * km) / 94,
      );
      await db.execute(
        sql`INSERT INTO locations (user_id, geo) VALUES (${id}, ST_SetSRID(ST_MakePoint(${cell.lng}, ${cell.lat}), 4326)::geography)`,
      );
      for (let v = 0; v < 3; v += 1) {
        const [photo] = await db
          .insert(schema.photos)
          .values({ userId: id, position: v, status: 'clean', width: 1080, height: 1350 })
          .returning({ id: schema.photos.id });
        const key = mediaKey(id, photo!.id);
        await storage.put(storage.buckets.media, key, await avatar(p, v), 'image/webp');
        await db
          .update(schema.photos)
          .set({ mediaKey: key })
          .where(eq(schema.photos.id, photo!.id));
      }
      const [vector] = await hashingProvider.embed([
        profileText({
          bio: p.bio,
          intention: p.intention,
          prompts: p.prompts.map(([promptKey, answer]) => ({ promptKey, answer })),
        }),
      ]);
      await db
        .insert(schema.profileEmbeddings)
        .values({ userId: id, embedding: vector!, model: hashingProvider.model });
    }
    return ids;
  } finally {
    storage.close();
    await pool.end();
  }
}

/** Demo activity: some members like the given account (optionally on its first prompt, with a comment). */
export async function demoLikes(
  email: string,
  likes: { name: string; comment?: string; onPrompt?: boolean }[],
): Promise<void> {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? '');
  try {
    const [target] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (!target) throw new Error(`No account ${email}`);
    const [prompt] = await db
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(eq(schema.prompts.userId, target.id))
      .limit(1);
    for (const l of likes) {
      const [actor] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, `${l.name.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`));
      if (!actor) continue;
      await db
        .insert(schema.interactions)
        .values({
          actorId: actor.id,
          targetId: target.id,
          kind: 'like',
          comment: l.comment ?? null,
          ...(l.onPrompt && prompt ? { itemType: 'prompt' as const, itemId: prompt.id } : {}),
        })
        .onConflictDoNothing();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  seedDemo({ reset: process.argv.includes('--reset') }).then(
    (ids) => process.stdout.write(`Seeded ${ids.length} demo members\n`),
    (error: unknown) => {
      process.stderr.write(
        `Seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
