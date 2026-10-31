// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { randomBytes } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  MAX_RESUME_LINKS,
  resumeWatermark,
  type PublicProfile,
  type ResumeCard,
  type ResumeLink,
  type ResumeLinkInput,
  type ResumeSection,
} from '@nexaheart/shared';
import type { StoredObject } from '@nexaheart/storage';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import { hashToken } from '../friends/links.js';

const { resumeLinks } = schema;

/** Wrong, expired, ended or of an inactive member: one answer for all. */
const invalid = () => new HttpError(404, ErrorCode.NotFound, "This link isn't valid.");

export interface ResumeDeps {
  ownCard(userId: string): Promise<PublicProfile | undefined>;
  /** The member's first clean profile photo. */
  openPhoto(photoId: string, ownerId: string): Promise<StoredObject>;
  communityName(): Promise<string>;
  now?: () => number;
}

type Row = typeof resumeLinks.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toLink = (r: Row): ResumeLink => ({
  id: r.id,
  label: r.label,
  sections: r.sections as ResumeSection[],
  createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt.toISOString(),
  views: r.views,
  lastViewedAt: iso(r.lastViewedAt),
});

const escapeXml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  );

/**
 * The photo with the watermark burned in: diagonal lines of "{label} · {shared} → {ends}" across
 * it, so a screenshot or a saved copy still says whom it was for. Made smaller than the original.
 */
export async function watermarked(input: Buffer, text: string): Promise<Buffer> {
  const image = sharp(input)
    .rotate()
    .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true });
  const { width = 720, height = 720 } = await image
    .clone()
    .toBuffer({ resolveWithObject: true })
    .then((r) => r.info);
  const line = escapeXml(text);
  const rows = Array.from({ length: 7 }, (_, i) => {
    const y = Math.round(((i + 0.5) * height) / 7);
    return `<text x="${width / 2}" y="${y}" text-anchor="middle">${line}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <g transform="rotate(-24 ${width / 2} ${height / 2})" font-family="DejaVu Sans, sans-serif"
       font-size="${Math.max(14, Math.round(width / 26))}" font-weight="bold"
       fill="#ffffff" fill-opacity="0.55" stroke="#000000" stroke-opacity="0.35" stroke-width="1">
      ${rows}
    </g></svg>`;
  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 80 })
    .toBuffer();
}

/** Phase 68b: a member's "matchmaking résumé", shared by short-lived links. */
export class ResumeService {
  private readonly now: () => number;

  constructor(
    private readonly db: Database,
    private readonly deps: ResumeDeps,
  ) {
    this.now = deps.now ?? Date.now;
  }

  private activeWhere(ownerId: string) {
    return and(
      eq(resumeLinks.ownerId, ownerId),
      isNull(resumeLinks.endedAt),
      gt(resumeLinks.expiresAt, new Date(this.now())),
    );
  }

  async list(ownerId: string): Promise<ResumeLink[]> {
    const rows = await this.db
      .select()
      .from(resumeLinks)
      .where(this.activeWhere(ownerId))
      .orderBy(desc(resumeLinks.createdAt));
    return rows.map(toLink);
  }

  async create(ownerId: string, input: ResumeLinkInput): Promise<ResumeLink & { token: string }> {
    if (!(await this.deps.ownCard(ownerId))) {
      throw new HttpError(409, ErrorCode.Conflict, 'Finish your profile first.');
    }
    const [{ n }] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(resumeLinks)
      .where(this.activeWhere(ownerId))) as [{ n: number }];
    if (n >= MAX_RESUME_LINKS) {
      throw new HttpError(409, ErrorCode.Conflict, `At most ${MAX_RESUME_LINKS} links at a time.`);
    }
    const token = randomBytes(24).toString('base64url');
    const [row] = await this.db
      .insert(resumeLinks)
      .values({
        ownerId,
        tokenHash: hashToken(token),
        label: input.label,
        sections: [...new Set(input.sections)],
        createdAt: new Date(this.now()),
        expiresAt: new Date(this.now() + input.days * 86_400_000),
      })
      .returning();
    await audit(this.db, {
      actorId: ownerId,
      action: 'resume.shared',
      targetType: 'resume_link',
      targetId: row!.id,
      meta: { days: input.days },
    });
    return { ...toLink(row!), token };
  }

  async end(ownerId: string, id: string): Promise<void> {
    const ended = await this.db
      .update(resumeLinks)
      .set({ endedAt: new Date(this.now()) })
      .where(and(eq(resumeLinks.id, id), this.activeWhere(ownerId)))
      .returning({ id: resumeLinks.id });
    if (ended.length === 0) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
  }

  /** A valid link of an active, unpaused member (taking a break pauses sharing too). */
  private async open(token: string): Promise<Row> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT rl.id FROM resume_links rl JOIN "user" u ON u.id = rl.user_id
      WHERE rl.token_hash = ${hashToken(token)} AND rl.ended_at IS NULL
        AND rl.expires_at > ${new Date(this.now()).toISOString()}::timestamptz AND u.status = 'active'
        AND (u.paused_at IS NULL OR u.paused_until <= now())`);
    if (!rows[0]) throw invalid();
    const [row] = await this.db.select().from(resumeLinks).where(eq(resumeLinks.id, rows[0].id));
    return row!;
  }

  /** The public card: only the sections the member chose. Each look is counted. */
  async card(token: string): Promise<ResumeCard> {
    const link = await this.open(token);
    const profile = await this.deps.ownCard(link.ownerId);
    if (!profile) throw invalid();
    await this.db
      .update(resumeLinks)
      .set({ views: sql`${resumeLinks.views} + 1`, lastViewedAt: new Date(this.now()) })
      .where(eq(resumeLinks.id, link.id));
    const has = (s: ResumeSection) => link.sections.includes(s);
    return {
      community: await this.deps.communityName(),
      label: link.label,
      sharedAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      displayName: profile.displayName,
      age: profile.age,
      gender: profile.gender,
      intention: profile.intention,
      photoUrl: has('photo') && profile.photos[0] ? `/v1/resume/${token}/photo` : null,
      bio: has('about') ? profile.bio : null,
      about: has('about') ? profile.about : null,
      prompts: has('prompts')
        ? profile.prompts.map(({ promptKey, answer }) => ({ promptKey, answer }))
        : [],
      faith: has('faith') ? (profile.faith ?? null) : null,
    };
  }

  /** The first profile photo, watermarked here; the original never leaves the server this way. */
  async photo(token: string): Promise<Buffer> {
    const link = await this.open(token);
    if (!link.sections.includes('photo')) throw invalid();
    const profile = await this.deps.ownCard(link.ownerId);
    const first = profile?.photos[0];
    if (!first) throw invalid();
    const object = await this.deps.openPhoto(first.id, link.ownerId);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
    return watermarked(
      Buffer.concat(chunks),
      resumeWatermark(link.label, link.createdAt.toISOString(), link.expiresAt.toISOString()),
    );
  }
}
