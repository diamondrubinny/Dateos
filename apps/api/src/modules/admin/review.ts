// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { type Database } from '@nexaheart/db';
import { ErrorCode, type PendingProfile, type ReviewDecision } from '@nexaheart/shared';
import { sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';

/**
 * Phase 68c: new profiles approved by hand, where the community asks for it. Moderators see what
 * any member would see on the profile (no email, no place) and approve or ask for a change.
 */
export class ProfileReviewService {
  constructor(private readonly db: Database) {}

  async pending(): Promise<PendingProfile[]> {
    const { rows } = await this.db.execute<{
      user_id: string;
      display_name: string;
      age: number;
      gender: string;
      intention: string;
      bio: string | null;
      prompts: { promptKey: string; answer: string }[] | null;
      photo_ids: string[] | null;
      resubmitted_at: Date | null;
      created_at: Date;
    }>(sql`
      SELECT p.user_id, p.display_name, date_part('year', age(current_date, p.birth_date))::int AS age,
        p.gender, p.intention, p.bio, p.resubmitted_at, p.created_at,
        (SELECT json_agg(json_build_object('promptKey', pr.prompt_key, 'answer', pr.answer) ORDER BY pr.position)
           FROM prompts pr WHERE pr.user_id = p.user_id) AS prompts,
        (SELECT array_agg(ph.id ORDER BY ph.position) FROM photos ph
           WHERE ph.user_id = p.user_id AND ph.purpose = 'profile' AND ph.status = 'clean') AS photo_ids
      FROM profiles p JOIN "user" u ON u.id = p.user_id AND u.status = 'active'
      WHERE p.review_status = 'pending'
      ORDER BY COALESCE(p.resubmitted_at, p.created_at)
      LIMIT 100`);
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      age: Number(r.age),
      gender: r.gender,
      intention: r.intention,
      bio: r.bio,
      prompts: r.prompts ?? [],
      photoIds: r.photo_ids ?? [],
      resubmitted: r.resubmitted_at !== null,
      since: new Date(r.resubmitted_at ?? r.created_at).toISOString(),
    }));
  }

  async decide(staffId: string, userId: string, decision: ReviewDecision): Promise<void> {
    await this.db.transaction(async (tx) => {
      const changes = decision.decision === 'changes';
      const { rows } = await tx.execute(sql`
        UPDATE profiles SET review_status = ${changes ? 'changes' : 'approved'},
          review_reason = ${changes ? decision.reason : null},
          review_note = ${changes ? decision.note : null},
          reviewed_at = now(), reviewed_by = ${staffId}
        WHERE user_id = ${userId} AND review_status = 'pending'
        RETURNING user_id`);
      if (rows.length === 0) throw new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
      await audit(tx, {
        actorId: staffId,
        action: changes ? 'profile.changes_asked' : 'profile.approved',
        targetType: 'user',
        targetId: userId,
        ...(changes ? { meta: { reason: decision.reason } } : {}),
      });
    });
  }
}
