// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { randomBytes } from 'node:crypto';
import { schema, type Database } from '@nexaheart/db';
import {
  ageOn,
  DAILY_INTERACTION_LIMIT,
  ErrorCode,
  FEDERATED_DECK_SIZE,
  FEDERATED_EXCLUDE_MAX,
  FEDERATION_CONSENT_VERSION,
  federatedDiscoverRequestSchema,
  federatedDiscoverResponseSchema,
  federatedForgetSchema,
  federatedLikeResponseSchema,
  federatedLikeSchema,
  federatedPairSchema,
  federationAliasSchema,
  type FederatedCard,
  type FederatedInteraction,
  type FederatedMatch,
  type FederatedProfile,
  type FederatedStatus,
  type FederatedViewer,
  type Gender,
  type Intention,
  type PromptKey,
  type RealtimeEvent,
} from '@nexaheart/shared';
import type { Storage, StoredObject } from '@nexaheart/storage';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../plugins/error-handler.js';
import { notOnBreak } from '../discovery/visibility.js';
import type { FederationService, IncomingSigned } from './service.js';

const {
  consents,
  federationAliases,
  federationDecisions,
  federationMatches,
  photos,
  preferences,
  profiles,
  prompts,
} = schema;
type PartnerRow = typeof schema.federationPartners.$inferSelect;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const badRequest = () => new HttpError(400, ErrorCode.BadRequest, 'Malformed request.');
/** How long the deck waits for a partner before showing the others. */
const DECK_TIMEOUT_MS = 4000;

/** The member's latest `federation` consent is a yes. */
const joinedSql = (userId: SQL) => sql`(
  SELECT c.granted FROM consents c
  WHERE c.user_id = ${userId} AND c.kind = 'federation'
  ORDER BY c.created_at DESC, c.id DESC LIMIT 1) IS TRUE`;

/**
 * Who partners may see and reach (phase 28b): joined, active, not on a break, not incognito, with
 * a profile, preferences and a clean profile photo. `u` and `p` are fixed aliases in our own SQL.
 */
const takingPartSql = sql`u.status = 'active' AND ${notOnBreak('u')} AND NOT u.incognito
  AND ${joinedSql(sql`p.user_id`)}
  AND EXISTS (SELECT 1 FROM preferences pr0 WHERE pr0.user_id = p.user_id)
  AND EXISTS (SELECT 1 FROM photos ph WHERE ph.user_id = p.user_id AND ph.status = 'clean' AND ph.purpose = 'profile')`;

const newAlias = () => randomBytes(16).toString('base64url');

/**
 * Discovery and matching across partner communities (phase 28b). Members here are known to each
 * partner only by a random alias; partners' members are known here only by theirs. Each server
 * keeps its own side of a match; nothing else about a partner's member is stored.
 */
export class FederatedMembers {
  constructor(
    private readonly db: Database,
    private readonly federation: FederationService,
    private readonly storage: Storage,
    private readonly today: () => string,
  ) {}

  /** Live updates to members here (phase 28c): their matches across communities changed. */
  private notify: (userId: string, event: RealtimeEvent) => void = () => undefined;
  useRealtime(notify: (userId: string, event: RealtimeEvent) => void): void {
    this.notify = notify;
  }

  // ---------------------------------------------------------------- helpers

  private async joined(userId: string): Promise<boolean> {
    const { rows } = await this.db.execute<{ ok: boolean }>(
      sql`SELECT ${joinedSql(sql`${userId}`)} AS ok`,
    );
    return Boolean(rows[0]?.ok);
  }

  /** The member may act across communities right now (else 403). */
  async requireTakingPart(userId: string): Promise<void> {
    const { rows } = await this.db.execute<{ ok: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM profiles p JOIN "user" u ON u.id = p.user_id
        WHERE p.user_id = ${userId} AND ${takingPartSql}) AS ok`);
    if (!rows[0]?.ok) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Join partner communities first.');
    }
  }

  private async requirePartner(partnerId: string): Promise<PartnerRow> {
    const partner = await this.federation.activePartner(partnerId);
    if (!partner) throw notFound();
    return partner;
  }

  /** This member's alias at a partner, made on first use. */
  async aliasOf(partnerId: string, userId: string): Promise<string> {
    await this.db
      .insert(federationAliases)
      .values({ partnerId, userId, alias: newAlias() })
      .onConflictDoNothing();
    const [row] = await this.db
      .select({ alias: federationAliases.alias })
      .from(federationAliases)
      .where(and(eq(federationAliases.partnerId, partnerId), eq(federationAliases.userId, userId)));
    return row!.alias;
  }

  /** The member here behind an alias we gave a partner, if they still take part. */
  async memberOf(partnerId: string, alias: string): Promise<string | null> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT p.user_id AS id
      FROM federation_aliases fa
      JOIN profiles p ON p.user_id = fa.user_id
      JOIN "user" u ON u.id = p.user_id
      WHERE fa.partner_id = ${partnerId} AND fa.alias = ${alias} AND ${takingPartSql}`);
    return rows[0]?.id ?? null;
  }

  private async firstPhoto(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(
        and(eq(photos.userId, userId), eq(photos.status, 'clean'), eq(photos.purpose, 'profile')),
      )
      .orderBy(asc(photos.position))
      .limit(1);
    return row?.id ?? null;
  }

  private photoUrl(partnerId: string, photoId: string): string {
    return `/v1/federated/photos/${partnerId}/${photoId}`;
  }

  // ---------------------------------------------------------------- members

  async status(userId: string): Promise<FederatedStatus> {
    const partners = await this.federation.activePartners();
    return {
      available: partners.length > 0,
      joined: await this.joined(userId),
      consentVersion: FEDERATION_CONSENT_VERSION,
      partners: partners.map((p) => ({ id: p.id, name: p.name, privacyUrl: p.privacyUrl })),
    };
  }

  /** Joining is an explicit, versioned consent ⚖️. */
  async join(userId: string, version: string): Promise<FederatedStatus> {
    if (version !== FEDERATION_CONSENT_VERSION) {
      throw new HttpError(409, ErrorCode.Conflict, 'A newer version of this text is available.');
    }
    if ((await this.federation.activePartners()).length === 0) throw notFound();
    await this.db.insert(consents).values({ userId, kind: 'federation', granted: true, version });
    await audit(this.db, {
      actorId: userId,
      action: 'federation.member_joined',
      targetType: 'user',
      targetId: userId,
    });
    return this.status(userId);
  }

  /**
   * Leaving: every partner is told to forget this member's alias (their likes, passes and matches
   * there), and everything here is deleted. Partners that can't be reached now still lose the
   * alias, so nothing they kept can be linked back to this member.
   */
  async leave(userId: string): Promise<FederatedStatus> {
    await this.forgetEverywhere(userId);
    await this.db.insert(consents).values({
      userId,
      kind: 'federation',
      granted: false,
      version: FEDERATION_CONSENT_VERSION,
    });
    await audit(this.db, {
      actorId: userId,
      action: 'federation.member_left',
      targetType: 'user',
      targetId: userId,
    });
    return this.status(userId);
  }

  /** Before an account is deleted: partners are told, then nothing is left here. */
  async forgetEverywhere(userId: string): Promise<void> {
    const aliases = await this.db
      .select({ partnerId: federationAliases.partnerId, alias: federationAliases.alias })
      .from(federationAliases)
      .where(eq(federationAliases.userId, userId));
    const partners = new Map((await this.federation.activePartners()).map((p) => [p.id, p]));
    await Promise.all(
      aliases.map(async (a) => {
        const partner = partners.get(a.partnerId);
        if (!partner) return;
        await this.federation
          .send(partner.url, 'POST', '/v1/federation/forget', { alias: a.alias })
          .catch(() => undefined);
      }),
    );
    await this.db.transaction(async (tx) => {
      await tx.delete(federationMatches).where(eq(federationMatches.userId, userId));
      await tx.delete(federationDecisions).where(eq(federationDecisions.userId, userId));
      await tx.delete(federationAliases).where(eq(federationAliases.userId, userId));
    });
  }

  /** What our viewer's server tells a partner: only what the two-way filter needs. */
  private async viewer(userId: string, alias: string): Promise<FederatedViewer> {
    const [row] = await this.db
      .select({
        gender: profiles.gender,
        interestedIn: profiles.interestedIn,
        birthDate: profiles.birthDate,
        intention: profiles.intention,
        ageMin: preferences.ageMin,
        ageMax: preferences.ageMax,
        wants: preferences.intentions,
      })
      .from(profiles)
      .innerJoin(preferences, eq(preferences.userId, profiles.userId))
      .where(eq(profiles.userId, userId));
    if (!row) throw notFound();
    return {
      alias,
      gender: row.gender as Gender,
      interestedIn: row.interestedIn as Gender[],
      age: ageOn(row.birthDate, this.today()),
      ageMin: row.ageMin,
      ageMax: row.ageMax,
      intention: row.intention as Intention,
      wants: row.wants as Intention[],
    };
  }

  /** Cards from every active partner, a few from each; a partner that's slow or down is skipped. */
  async deck(userId: string): Promise<FederatedProfile[]> {
    await this.requireTakingPart(userId);
    const partners = await this.federation.activePartners();
    const perPartner = await Promise.all(
      partners.map(async (partner) => {
        const alias = await this.aliasOf(partner.id, userId);
        const decided = await this.db
          .select({ alias: federationDecisions.alias })
          .from(federationDecisions)
          .where(
            and(
              eq(federationDecisions.userId, userId),
              eq(federationDecisions.partnerId, partner.id),
            ),
          )
          .orderBy(desc(federationDecisions.createdAt))
          .limit(FEDERATED_EXCLUDE_MAX);
        const exclude = new Set(decided.map((d) => d.alias));
        const answer = await this.federation
          .send(
            partner.url,
            'POST',
            '/v1/federation/discover',
            { viewer: await this.viewer(userId, alias), exclude: [...exclude] },
            DECK_TIMEOUT_MS,
          )
          .catch(() => null);
        // A partner's answer is untrusted: anything that doesn't fit the schema is dropped.
        const parsed = federatedDiscoverResponseSchema.safeParse(answer);
        if (!parsed.success) return [];
        return parsed.data.cards
          .filter((c) => !exclude.has(c.alias))
          .map((c) => this.toProfile(partner, c));
      }),
    );
    // Interleave, so one big partner doesn't fill the deck.
    const deck: FederatedProfile[] = [];
    for (let i = 0; deck.length < FEDERATED_DECK_SIZE; i++) {
      const round = perPartner.flatMap((cards) => cards.slice(i, i + 1));
      if (round.length === 0) break;
      deck.push(...round);
    }
    return deck.slice(0, FEDERATED_DECK_SIZE);
  }

  private toProfile(partner: PartnerRow, card: FederatedCard): FederatedProfile {
    return {
      partnerId: partner.id,
      community: partner.name,
      alias: card.alias,
      displayName: card.displayName,
      age: card.age,
      gender: card.gender,
      intention: card.intention,
      bio: card.bio,
      languages: card.languages,
      prompts: card.prompts,
      photos: card.photos.map((ph) => ({
        id: ph.id,
        url: this.photoUrl(partner.id, ph.id),
        width: ph.width,
        height: ph.height,
      })),
      verified: card.verified,
    };
  }

  /** A like, pass or block on a partner's member. A like is sent to their community at once. */
  async interact(userId: string, input: FederatedInteraction): Promise<{ matched: boolean }> {
    await this.requireTakingPart(userId);
    const partner = await this.requirePartner(input.partnerId);
    const key = and(
      eq(federationDecisions.userId, userId),
      eq(federationDecisions.partnerId, partner.id),
      eq(federationDecisions.alias, input.alias),
    );
    const myAlias = await this.aliasOf(partner.id, userId);

    if (input.kind === 'block') {
      // A block replaces any earlier decision and ends a match on both sides.
      await this.db.transaction(async (tx) => {
        await tx.delete(federationDecisions).where(key);
        await tx
          .insert(federationDecisions)
          .values({ userId, partnerId: partner.id, alias: input.alias, kind: 'block' });
      });
      await this.endMatch(partner, userId, myAlias, input.alias);
      await audit(this.db, {
        actorId: userId,
        action: 'federation.member_blocked',
        targetType: 'partner',
        targetId: partner.url,
      });
      return { matched: false };
    }

    await this.db.transaction(async (tx) => {
      // The same daily limit as here, counted together with local decisions.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`interactions:${userId}`}))`);
      const { rows } = await tx.execute<{ n: number }>(sql`
        SELECT (SELECT count(*) FROM interactions
                 WHERE actor_id = ${userId} AND created_at >= date_trunc('day', now()))
             + (SELECT count(*) FROM federation_decisions
                 WHERE user_id = ${userId} AND created_at >= date_trunc('day', now())) AS n`);
      if (Number(rows[0]?.n ?? 0) >= DAILY_INTERACTION_LIMIT) {
        throw new HttpError(429, ErrorCode.RateLimited, 'Daily limit reached. Come back tomorrow.');
      }
      const inserted = await tx
        .insert(federationDecisions)
        .values({ userId, partnerId: partner.id, alias: input.alias, kind: input.kind })
        .onConflictDoNothing()
        .returning({ alias: federationDecisions.alias });
      if (inserted.length === 0) {
        throw new HttpError(409, ErrorCode.Conflict, 'You already decided on this profile.');
      }
    });
    if (input.kind === 'pass') return { matched: false };

    const [me] = await this.db
      .select({ name: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    const photoId = await this.firstPhoto(userId);
    let answer: unknown;
    try {
      answer = await this.federation.send(partner.url, 'POST', '/v1/federation/likes', {
        from: myAlias,
        to: input.alias,
        name: me!.name,
        photoId: photoId!,
      });
    } catch (error) {
      // Not delivered: undo it, so the member can try again.
      await this.db.delete(federationDecisions).where(key);
      throw error;
    }
    const parsed = federatedLikeResponseSchema.safeParse(answer);
    if (!parsed.success || !parsed.data.matched || !parsed.data.name) return { matched: false };
    await this.db
      .insert(federationMatches)
      .values({
        partnerId: partner.id,
        userId,
        alias: input.alias,
        name: parsed.data.name,
        photoId: parsed.data.photoId,
      })
      .onConflictDoNothing();
    return { matched: true };
  }

  async matches(userId: string): Promise<FederatedMatch[]> {
    const partners = new Map((await this.federation.activePartners()).map((p) => [p.id, p]));
    if (partners.size === 0) return [];
    const rows = await this.db
      .select({
        id: federationMatches.id,
        partnerId: federationMatches.partnerId,
        alias: federationMatches.alias,
        name: federationMatches.name,
        photoId: federationMatches.photoId,
        createdAt: federationMatches.createdAt,
        last: sql<{
          body: string;
          mine: boolean;
          flags: string[];
          created_at: string;
        } | null>`(SELECT json_build_object('body', fm.body, 'mine', fm.mine, 'flags', fm.flags, 'created_at', fm.created_at)
          FROM federation_messages fm WHERE fm.match_id = federation_matches.id
          ORDER BY fm.created_at DESC, fm.id DESC LIMIT 1)`,
        unread: sql<number>`(SELECT count(*)::int FROM federation_messages fm
          WHERE fm.match_id = federation_matches.id AND NOT fm.mine
            AND fm.created_at > COALESCE(federation_matches.read_at, 'epoch'))`,
      })
      .from(federationMatches)
      .where(
        and(
          eq(federationMatches.userId, userId),
          inArray(federationMatches.partnerId, [...partners.keys()]),
        ),
      )
      // The most recent conversation first.
      .orderBy(
        desc(
          sql`COALESCE((SELECT max(fm.created_at) FROM federation_messages fm WHERE fm.match_id = federation_matches.id), federation_matches.created_at)`,
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      partnerId: r.partnerId,
      community: partners.get(r.partnerId)!.name,
      alias: r.alias,
      displayName: r.name,
      photo: r.photoId
        ? { id: r.photoId, url: this.photoUrl(r.partnerId, r.photoId), width: null, height: null }
        : null,
      createdAt: r.createdAt.toISOString(),
      lastMessage: r.last
        ? {
            body: r.last.body,
            mine: r.last.mine,
            hidden: !r.last.mine && r.last.flags.some((f) => f.startsWith('harm:')),
            createdAt: new Date(r.last.created_at).toISOString(),
          }
        : null,
      unread: r.unread,
    }));
  }

  async unmatch(userId: string, matchId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(federationMatches)
      .where(and(eq(federationMatches.id, matchId), eq(federationMatches.userId, userId)));
    if (!row) throw notFound();
    const partner = await this.federation.activePartner(row.partnerId);
    if (!partner) throw notFound();
    await this.endMatch(partner, userId, await this.aliasOf(partner.id, userId), row.alias);
  }

  /** Ends a match here and tells the partner (best effort: they delete theirs when told). */
  private async endMatch(
    partner: PartnerRow,
    userId: string,
    myAlias: string,
    theirAlias: string,
  ): Promise<void> {
    await this.db
      .delete(federationMatches)
      .where(
        and(
          eq(federationMatches.partnerId, partner.id),
          eq(federationMatches.userId, userId),
          eq(federationMatches.alias, theirAlias),
        ),
      );
    await this.federation
      .send(partner.url, 'POST', '/v1/federation/unmatch', { from: myAlias, to: theirAlias })
      .catch(() => undefined);
  }

  /** Suspended or lost access: every match across communities ends. */
  async endAllMatches(userId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(federationMatches)
      .where(eq(federationMatches.userId, userId));
    const partners = new Map((await this.federation.activePartners()).map((p) => [p.id, p]));
    for (const row of rows) {
      const partner = partners.get(row.partnerId);
      if (partner) {
        await this.endMatch(partner, userId, await this.aliasOf(partner.id, userId), row.alias);
      } else {
        await this.db.delete(federationMatches).where(eq(federationMatches.id, row.id));
      }
    }
  }

  /** A partner's photo, fetched for this member through this server. */
  async photo(userId: string, partnerId: string, photoId: string): Promise<Buffer> {
    if (!(await this.joined(userId))) throw notFound();
    const partner = await this.requirePartner(partnerId);
    const alias = await this.aliasOf(partner.id, userId);
    const image = await this.federation.fetchImage(
      partner.url,
      `/v1/federation/photos/${photoId}?viewer=${alias}`,
    );
    if (!image) throw notFound();
    return image;
  }

  // ---------------------------------------------------------------- partners' servers

  /** A partner asks for cards for one of its members: only people who pass both ways. */
  async receiveDiscover(incoming: IncomingSigned): Promise<{ cards: FederatedCard[] }> {
    const partner = await this.federation.verifyActive(incoming);
    const parsed = federatedDiscoverRequestSchema.safeParse(parseBody(incoming));
    if (!parsed.success) throw badRequest();
    const { viewer, exclude } = parsed.data;
    const today = sql`${this.today()}::date`;
    const { rows } = await this.db.execute<{
      id: string;
      name: string;
      birth_date: string;
      gender: Gender;
      intention: Intention;
      bio: string | null;
      languages: string[];
      verified: boolean;
    }>(sql`
      SELECT p.user_id AS id, p.display_name AS name, p.birth_date::text AS birth_date,
             p.gender::text AS gender, p.intention::text AS intention, p.bio, p.languages,
             p.verified_at IS NOT NULL AS verified
      FROM profiles p
      JOIN "user" u ON u.id = p.user_id
      JOIN preferences pr ON pr.user_id = p.user_id
      LEFT JOIN federation_aliases fa ON fa.partner_id = ${partner.id} AND fa.user_id = p.user_id
      WHERE ${takingPartSql}
        -- Both ways: gender and who each wants, ages, intentions.
        AND p.gender::text = ANY(${sql.param(viewer.interestedIn)}::text[])
        AND ${viewer.gender}::text = ANY(p.interested_in::text[])
        AND date_part('year', age(${today}, p.birth_date)) BETWEEN ${viewer.ageMin} AND ${viewer.ageMax}
        AND ${viewer.age} BETWEEN pr.age_min AND pr.age_max
        AND (${viewer.wants.length} = 0 OR p.intention::text = ANY(${sql.param(viewer.wants)}::text[]))
        AND (cardinality(pr.intentions) = 0 OR ${viewer.intention}::text = ANY(pr.intentions::text[]))
        -- Not someone the viewer already decided on, and not someone who blocked the viewer.
        AND (fa.alias IS NULL OR NOT (fa.alias = ANY(${sql.param(exclude)}::text[])))
        AND NOT EXISTS (SELECT 1 FROM federation_decisions d
          WHERE d.user_id = p.user_id AND d.partner_id = ${partner.id}
            AND d.alias = ${viewer.alias} AND d.kind = 'block')
      -- A different order for each viewer and day.
      ORDER BY md5(p.user_id || ${viewer.alias} || ${this.today()})
      LIMIT ${FEDERATED_DECK_SIZE}`);
    if (rows.length === 0) return { cards: [] };
    const ids = rows.map((r) => r.id);
    await this.db
      .insert(federationAliases)
      .values(ids.map((id) => ({ partnerId: partner.id, userId: id, alias: newAlias() })))
      .onConflictDoNothing();
    const aliases = new Map(
      (
        await this.db
          .select({ userId: federationAliases.userId, alias: federationAliases.alias })
          .from(federationAliases)
          .where(
            and(
              eq(federationAliases.partnerId, partner.id),
              inArray(federationAliases.userId, ids),
            ),
          )
      ).map((a) => [a.userId, a.alias]),
    );
    const promptRows = await this.db
      .select({ userId: prompts.userId, promptKey: prompts.promptKey, answer: prompts.answer })
      .from(prompts)
      .where(inArray(prompts.userId, ids))
      .orderBy(asc(prompts.position));
    const photoRows = await this.db
      .select({ id: photos.id, userId: photos.userId, width: photos.width, height: photos.height })
      .from(photos)
      .where(
        and(inArray(photos.userId, ids), eq(photos.status, 'clean'), eq(photos.purpose, 'profile')),
      )
      .orderBy(asc(photos.position));
    const cards = rows.flatMap((r): FederatedCard[] => {
      const alias = aliases.get(r.id);
      const own = photoRows.filter((ph) => ph.userId === r.id);
      if (!alias || own.length === 0) return [];
      return [
        {
          alias,
          displayName: r.name,
          age: ageOn(r.birth_date, this.today()),
          gender: r.gender,
          intention: r.intention,
          bio: r.bio,
          languages: r.languages.slice(0, 10),
          prompts: promptRows
            .filter((pr) => pr.userId === r.id)
            .map((pr) => ({ promptKey: pr.promptKey as PromptKey, answer: pr.answer })),
          photos: own.map((ph) => ({ id: ph.id, width: ph.width, height: ph.height })),
          verified: r.verified,
        },
      ];
    });
    return { cards };
  }

  /** A partner's member liked one of ours: a match if ours liked them before. */
  async receiveLike(
    incoming: IncomingSigned,
  ): Promise<{ matched: boolean; name: string | null; photoId: string | null }> {
    const partner = await this.federation.verifyActive(incoming);
    const parsed = federatedLikeSchema.safeParse(parseBody(incoming));
    if (!parsed.success) throw badRequest();
    const like = parsed.data;
    const no = { matched: false, name: null, photoId: null };
    const userId = await this.memberOf(partner.id, like.to);
    if (!userId) return no;
    const [mine] = await this.db
      .select({ kind: federationDecisions.kind })
      .from(federationDecisions)
      .where(
        and(
          eq(federationDecisions.userId, userId),
          eq(federationDecisions.partnerId, partner.id),
          eq(federationDecisions.alias, like.from),
        ),
      );
    if (mine?.kind !== 'like') return no;
    await this.db
      .insert(federationMatches)
      .values({
        partnerId: partner.id,
        userId,
        alias: like.from,
        name: like.name,
        photoId: like.photoId,
      })
      .onConflictDoNothing();
    this.notify(userId, { type: 'federated.matches' });
    const [me] = await this.db
      .select({ name: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.userId, userId));
    return { matched: true, name: me!.name, photoId: await this.firstPhoto(userId) };
  }

  /** A partner's member unmatched or blocked one of ours. */
  async receiveUnmatch(incoming: IncomingSigned): Promise<void> {
    const partner = await this.federation.verifyActive(incoming);
    const parsed = federatedPairSchema.safeParse(parseBody(incoming));
    if (!parsed.success) throw badRequest();
    const [owner] = await this.db
      .select({ userId: federationAliases.userId })
      .from(federationAliases)
      .where(
        and(
          eq(federationAliases.partnerId, partner.id),
          eq(federationAliases.alias, parsed.data.to),
        ),
      );
    if (!owner) return;
    await this.db
      .delete(federationMatches)
      .where(
        and(
          eq(federationMatches.partnerId, partner.id),
          eq(federationMatches.userId, owner.userId),
          eq(federationMatches.alias, parsed.data.from),
        ),
      );
    this.notify(owner.userId, { type: 'federated.matches' });
  }

  /** A partner's member left (or deleted their account): forget everything about that alias. */
  async receiveForget(incoming: IncomingSigned): Promise<void> {
    const partner = await this.federation.verifyActive(incoming);
    const parsed = federatedForgetSchema.safeParse(parseBody(incoming));
    if (!parsed.success) throw badRequest();
    const { alias } = parsed.data;
    await this.db.transaction(async (tx) => {
      const ended = await tx
        .delete(federationMatches)
        .where(and(eq(federationMatches.partnerId, partner.id), eq(federationMatches.alias, alias)))
        .returning({ userId: federationMatches.userId });
      for (const m of ended) this.notify(m.userId, { type: 'federated.matches' });
      await tx
        .delete(federationDecisions)
        .where(
          and(eq(federationDecisions.partnerId, partner.id), eq(federationDecisions.alias, alias)),
        );
    });
  }

  /**
   * A partner asks for a photo for one of its members: only a profile photo of someone taking
   * part, who was shown to that partner and hasn't blocked the viewer.
   */
  async receivePhoto(
    incoming: IncomingSigned,
    photoId: string,
    viewer: string,
  ): Promise<StoredObject> {
    const partner = await this.federation.verifyActive(incoming);
    if (!federationAliasSchema.safeParse(viewer).success) throw badRequest();
    const { rows } = await this.db.execute<{ key: string }>(sql`
      SELECT ph.media_key AS key
      FROM photos ph
      JOIN profiles p ON p.user_id = ph.user_id
      JOIN "user" u ON u.id = p.user_id
      JOIN federation_aliases fa ON fa.partner_id = ${partner.id} AND fa.user_id = p.user_id
      WHERE ph.id = ${photoId} AND ph.status = 'clean' AND ph.purpose = 'profile'
        AND ph.media_key IS NOT NULL AND ${takingPartSql}
        AND NOT EXISTS (SELECT 1 FROM federation_decisions d
          WHERE d.user_id = p.user_id AND d.partner_id = ${partner.id}
            AND d.alias = ${viewer} AND d.kind = 'block')`);
    if (!rows[0]) throw notFound();
    return this.storage.get(this.storage.buckets.media, rows[0].key);
  }
}

function parseBody(incoming: IncomingSigned): unknown {
  try {
    return JSON.parse(incoming.body);
  } catch {
    return null;
  }
}
