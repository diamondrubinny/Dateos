// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  decryptSecret,
  encryptSecret,
  OutboundError,
  safeFetch,
  type OutboundOptions,
} from '@nexaheart/integrations';
import {
  ErrorCode,
  FEDERATION_MAX_SKEW_SECONDS,
  FEDERATION_NONCE_SECONDS,
  FEDERATION_VERSION,
  FEDERATION_WELL_KNOWN,
  FEDERATION_PREVIOUS_KEY_DAYS,
  FederationHeader,
  federationIdentitySchema,
  federationKeyChangeSchema,
  type FederationKeyChange,
  type FederationIdentity,
  type Partner,
  type PartnersResponse,
  type PartnerStatus,
} from '@nexaheart/shared';
import { and, desc, eq, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { audit } from '../../lib/audit.js';
import {
  generateFederationKeys,
  newNonce,
  originOf,
  signParts,
  verifyParts,
} from '../../lib/federation-sign.js';
import { HttpError } from '../../plugins/error-handler.js';

const {
  federationAliases,
  federationDecisions,
  federationKeys,
  federationMatches,
  federationOutbox,
  federationPartners,
  federationReportsOut,
  reports,
} = schema;
type PartnerRow = typeof federationPartners.$inferSelect;

const KEY_CONTEXT = 'federation.privateKey';
/** Invitations from other communities waiting for an admin, at most. */
export const MAX_PENDING_INVITATIONS = 20;
/** A partner's JSON answer and a partner's photo, at most. */
const MAX_JSON_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
/** 28d: the outbox retries for this long, with a pause from 1 minute growing to 6 hours. */
export const OUTBOX_GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
const OUTBOX_FIRST_PAUSE_MS = 60 * 1000;
const OUTBOX_MAX_PAUSE_MS = 6 * 60 * 60 * 1000;
export const outboxPause = (attempts: number) =>
  Math.min(OUTBOX_FIRST_PAUSE_MS * 2 ** Math.max(0, attempts - 1), OUTBOX_MAX_PAUSE_MS);
const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const unauthorized = (why: string) => new HttpError(401, ErrorCode.Unauthorized, why);

export interface FederationDeps {
  /** `FEDERATION=on`. */
  on: boolean;
  /** INTEGRATIONS_KEY: seals this server's private key. */
  sealKey: Buffer | null;
  /** This server's API address. */
  apiUrl: string;
  /** The web app's address, for the privacy policy link. */
  appUrl: string;
  instance: () => Promise<{ name: string; contactEmail: string | null }>;
  outbound: OutboundOptions;
}

/** A signed request as received: what the route hands over for checking. */
export interface IncomingSigned {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const header = (h: IncomingSigned['headers'], name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Communities that connect (phase 28a): this server's identity and key, partnerships with other
 * communities, and signed requests between them. Members' data (28b) is in `members.ts`.
 */
export class FederationService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly deps: FederationDeps,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.deps.on && this.deps.sealKey !== null;
  }

  private get self(): string {
    return originOf(this.deps.apiUrl);
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new HttpError(503, ErrorCode.ServiceUnavailable, 'Connecting communities is off.');
    }
  }

  /** This server's key pair, made on first use. */
  private async keys(): Promise<{ publicKey: string; privateKey: string }> {
    const [row] = await this.db.select().from(federationKeys).where(eq(federationKeys.id, 1));
    const sealKey = this.deps.sealKey!;
    if (row) {
      const privateKey = decryptSecret(sealKey, KEY_CONTEXT, row.privateKeySealed);
      if (!privateKey) {
        throw new HttpError(
          500,
          ErrorCode.Internal,
          'The federation key can’t be read: INTEGRATIONS_KEY changed.',
        );
      }
      return { publicKey: row.publicKey, privateKey };
    }
    const fresh = generateFederationKeys();
    await this.db
      .insert(federationKeys)
      .values({
        id: 1,
        publicKey: fresh.publicKey,
        privateKeySealed: encryptSecret(sealKey, KEY_CONTEXT, fresh.privateKey),
      })
      .onConflictDoNothing();
    // Two first requests at once: whoever wrote first wins, both read the same row.
    return this.keys();
  }

  /** The key before the last rotation, for a week, only to announce the new one. */
  private async previousKey(): Promise<string | null> {
    const [row] = await this.db.select().from(federationKeys).where(eq(federationKeys.id, 1));
    if (!row?.previousPrivateKeySealed || !row.rotatedAt) return null;
    if (this.now() - row.rotatedAt.getTime() > FEDERATION_PREVIOUS_KEY_DAYS * 86_400_000) {
      return null;
    }
    return decryptSecret(this.deps.sealKey!, KEY_CONTEXT, row.previousPrivateKeySealed);
  }

  /**
   * Rotates this community's signing key (admins). Partners are told the new key in a message
   * signed with the old one, plus a proof signed with the new one; a partner that can't be
   * reached gets it from the outbox. Refused while an earlier announcement still waits.
   */
  async rotateKey(actorId: string): Promise<PartnersResponse> {
    this.requireEnabled();
    const [waiting] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(federationOutbox)
      .where(eq(federationOutbox.signWithPrevious, true));
    if ((waiting?.n ?? 0) > 0) {
      throw new HttpError(
        409,
        ErrorCode.Conflict,
        'Some partners haven’t received the last new key yet.',
      );
    }
    const current = await this.keys();
    const [row] = await this.db.select().from(federationKeys).where(eq(federationKeys.id, 1));
    const fresh = generateFederationKeys();
    const rotatedAt = new Date(this.now());
    await this.db
      .update(federationKeys)
      .set({
        publicKey: fresh.publicKey,
        privateKeySealed: encryptSecret(this.deps.sealKey!, KEY_CONTEXT, fresh.privateKey),
        previousPublicKey: current.publicKey,
        previousPrivateKeySealed: row!.privateKeySealed,
        rotatedAt,
      })
      .where(eq(federationKeys.id, 1));
    const announcement: FederationKeyChange = {
      publicKey: fresh.publicKey,
      rotatedAt: rotatedAt.toISOString(),
      proof: signParts(fresh.privateKey, keyProofParts(this.self, fresh.publicKey, rotatedAt)),
    };
    for (const partner of await this.reachablePartners()) {
      try {
        await this.send(
          partner.url,
          'POST',
          FEDERATION_KEY_PATH,
          announcement,
          undefined,
          'previous',
        );
      } catch (error) {
        await this.db.insert(federationOutbox).values({
          partnerId: partner.id,
          path: FEDERATION_KEY_PATH,
          payload: announcement,
          attempts: 1,
          nextAttemptAt: new Date(this.now() + outboxPause(1)),
          lastError: (error as Error).message.slice(0, 200),
          createdAt: new Date(this.now()),
          signWithPrevious: true,
        });
      }
    }
    await audit(this.db, {
      actorId,
      action: 'federation.key_rotated',
      targetType: 'instance',
      targetId: this.self,
    });
    return this.list();
  }

  /** A partner announces its new key: signed with the key we know, and proven with the new one. */
  async receiveKeyChange(incoming: IncomingSigned): Promise<void> {
    const { partner } = await this.verify(incoming);
    if (!partner || partner.status === 'ended') throw unauthorized('Unknown community.');
    let body: unknown = null;
    try {
      body = JSON.parse(incoming.body);
    } catch {
      // handled below
    }
    const parsed = federationKeyChangeSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, ErrorCode.BadRequest, 'Malformed request.');
    const change = parsed.data;
    const parts = keyProofParts(partner.url, change.publicKey, new Date(change.rotatedAt));
    if (!verifyParts(change.publicKey, parts, change.proof)) {
      throw unauthorized('The new key isn’t proven.');
    }
    await this.db
      .update(federationPartners)
      .set({ publicKey: change.publicKey })
      .where(eq(federationPartners.id, partner.id));
    await audit(this.db, {
      actorId: null,
      action: 'federation.key_changed',
      targetType: 'partner',
      targetId: partner.url,
    });
  }

  /** What `/.well-known/nexaheart` publishes. */
  async identity(): Promise<FederationIdentity> {
    this.requireEnabled();
    const info = await this.deps.instance();
    return {
      version: FEDERATION_VERSION,
      name: info.name.slice(0, 80),
      url: this.self,
      publicKey: (await this.keys()).publicKey,
      contact: info.contactEmail,
      privacyUrl: `${this.deps.appUrl}/privacy`,
    };
  }

  // ------------------------------------------------------------------ outgoing

  /** Fetches and checks another community's identity (the SSRF guard applies). */
  private async discover(url: string): Promise<FederationIdentity> {
    let res: Response;
    try {
      res = await safeFetch(
        `${originOf(url)}${FEDERATION_WELL_KNOWN}`,
        { method: 'GET', headers: { accept: 'application/json' } },
        this.deps.outbound,
      );
    } catch (error) {
      throw new HttpError(
        502,
        ErrorCode.BadGateway,
        error instanceof OutboundError ? error.message : 'That community can’t be reached.',
      );
    }
    if (!res.ok) {
      throw new HttpError(502, ErrorCode.BadGateway, 'That address isn’t a NexaHeart community.');
    }
    const parsed = federationIdentitySchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success || originOf(parsed.data.url) !== originOf(url)) {
      throw new HttpError(502, ErrorCode.BadGateway, 'That address isn’t a NexaHeart community.');
    }
    return { ...parsed.data, url: originOf(parsed.data.url) };
  }

  /** Sends a signed request to a partner. Throws a short message on failure. */
  private async signedFetch(
    to: string,
    method: 'GET' | 'POST',
    path: string,
    payload?: object,
    timeoutMs?: number,
    signWith?: 'previous',
  ): Promise<Response> {
    const privateKey =
      signWith === 'previous' ? await this.previousKey() : (await this.keys()).privateKey;
    if (!privateKey) {
      throw new HttpError(502, ErrorCode.BadGateway, 'The previous key is no longer kept.');
    }
    const body = payload ? JSON.stringify(payload) : '';
    const date = new Date(this.now()).toISOString();
    const nonce = newNonce();
    const signature = signParts(privateKey, {
      method,
      path,
      origin: this.self,
      date,
      nonce,
      body,
    });
    let res: Response;
    try {
      res = await safeFetch(
        `${to}${path}`,
        {
          method,
          headers: {
            ...(payload ? { 'content-type': 'application/json' } : {}),
            [FederationHeader.Origin]: this.self,
            [FederationHeader.Date]: date,
            [FederationHeader.Nonce]: nonce,
            [FederationHeader.Signature]: signature,
          },
          ...(payload ? { body } : {}),
        },
        timeoutMs ? { ...this.deps.outbound, timeoutMs } : this.deps.outbound,
      );
    } catch (error) {
      throw new HttpError(
        502,
        ErrorCode.BadGateway,
        error instanceof OutboundError ? error.message : 'That community can’t be reached.',
      );
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpError(502, ErrorCode.BadGateway, `That community answered ${res.status}.`);
    }
    return res;
  }

  /** A signed JSON request to a partner; the answer is untrusted and capped in size. */
  async send(
    to: string,
    method: 'GET' | 'POST',
    path: string,
    payload?: object,
    timeoutMs?: number,
    signWith?: 'previous',
  ): Promise<unknown> {
    const res = await this.signedFetch(to, method, path, payload, timeoutMs, signWith);
    const bytes = await readCapped(res, MAX_JSON_BYTES);
    if (!bytes) return null;
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      return null;
    }
  }

  /** A signed request for an image (a partner's photo), capped in size; null if it fails. */
  async fetchImage(to: string, path: string): Promise<Buffer | null> {
    const res = await this.signedFetch(to, 'GET', path).catch(() => null);
    if (!res) return null;
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return readCapped(res, MAX_IMAGE_BYTES);
  }

  // ------------------------------------------------------------------ outbox (28d)

  /**
   * Sends something a partner must eventually receive (forget, unmatch, a report, an outcome). If
   * it can't be delivered now, it waits in the outbox and is retried. Returns whether it arrived.
   */
  async deliver(partner: PartnerRow, path: string, payload: object): Promise<boolean> {
    try {
      await this.send(partner.url, 'POST', path, payload);
      return true;
    } catch (error) {
      const now = this.now();
      await this.db.insert(federationOutbox).values({
        partnerId: partner.id,
        path,
        payload,
        attempts: 1,
        nextAttemptAt: new Date(now + outboxPause(1)),
        lastError: (error as Error).message.slice(0, 200),
        createdAt: new Date(now),
      });
      return false;
    }
  }

  /** Retries what's due (still delivered to a suspended partner); gives up after 7 days. */
  async drainOutbox(limit = 50): Promise<{ sent: number; retry: number; dropped: number }> {
    const result = { sent: 0, retry: 0, dropped: 0 };
    if (!this.enabled) return result;
    const now = this.now();
    const due = await this.db
      .select({ row: federationOutbox, url: federationPartners.url })
      .from(federationOutbox)
      .innerJoin(federationPartners, eq(federationPartners.id, federationOutbox.partnerId))
      .where(
        and(
          lte(federationOutbox.nextAttemptAt, new Date(now)),
          inArray(federationPartners.status, ['active', 'suspended']),
        ),
      )
      .orderBy(federationOutbox.nextAttemptAt)
      .limit(limit);
    for (const { row, url } of due) {
      try {
        await this.send(
          url,
          'POST',
          row.path,
          row.payload as object,
          undefined,
          row.signWithPrevious ? 'previous' : undefined,
        );
        await this.db.delete(federationOutbox).where(eq(federationOutbox.id, row.id));
        result.sent += 1;
      } catch (error) {
        if (now - row.createdAt.getTime() >= OUTBOX_GIVE_UP_MS) {
          await this.db.delete(federationOutbox).where(eq(federationOutbox.id, row.id));
          await audit(this.db, {
            actorId: null,
            action: 'federation.outbox_dropped',
            targetType: 'partner',
            targetId: url,
            meta: { path: row.path, attempts: row.attempts },
          });
          result.dropped += 1;
          continue;
        }
        const attempts = row.attempts + 1;
        await this.db
          .update(federationOutbox)
          .set({
            attempts,
            nextAttemptAt: new Date(now + outboxPause(attempts)),
            lastError: (error as Error).message.slice(0, 200),
          })
          .where(eq(federationOutbox.id, row.id));
        result.retry += 1;
      }
    }
    return result;
  }

  /** Runs the outbox every minute; one API instance at a time (a Redis lock). */
  startOutbox(onError: (error: unknown) => void): () => void {
    const timer = setInterval(() => {
      void (async () => {
        if (!this.enabled) return;
        const lock = await this.redis.set('nexaheart:fed:outbox-lock', '1', 'EX', 55, 'NX');
        if (lock !== 'OK') return;
        await this.drainOutbox();
      })().catch(onError);
    }, 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }

  // ------------------------------------------------------------------ incoming

  /**
   * Checks a signed request: the date (5 minutes either way), a nonce never seen before, and the
   * signature with the partner's stored key, or (for an invitation only) the key the sender's own
   * address publishes now.
   */
  async verify(
    incoming: IncomingSigned,
    allowUnknown = false,
  ): Promise<{ origin: string; partner: PartnerRow | null; identity: FederationIdentity | null }> {
    this.requireEnabled();
    const origin = header(incoming.headers, FederationHeader.Origin);
    const date = header(incoming.headers, FederationHeader.Date);
    const nonce = header(incoming.headers, FederationHeader.Nonce);
    const signature = header(incoming.headers, FederationHeader.Signature);
    if (!origin || !date || !nonce || !signature || !/^[0-9a-f]{32}$/.test(nonce)) {
      throw unauthorized('Missing signature.');
    }
    let from: string;
    try {
      from = originOf(origin);
    } catch {
      throw unauthorized('Bad origin.');
    }
    if (from !== origin || from === this.self) throw unauthorized('Bad origin.');
    const at = Date.parse(date);
    if (!Number.isFinite(at) || Math.abs(this.now() - at) > FEDERATION_MAX_SKEW_SECONDS * 1000) {
      throw unauthorized('The request is too old or from the future.');
    }
    const [partner] = await this.db
      .select()
      .from(federationPartners)
      .where(eq(federationPartners.url, from));
    let publicKey = partner && partner.status !== 'ended' ? partner.publicKey : null;
    let identity: FederationIdentity | null = null;
    if (!publicKey) {
      if (!allowUnknown) throw unauthorized('Unknown community.');
      identity = await this.discover(from);
      publicKey = identity.publicKey;
    }
    const parts = {
      method: incoming.method,
      path: incoming.path,
      origin,
      date,
      nonce,
      body: incoming.body,
    };
    if (!verifyParts(publicKey, parts, signature)) throw unauthorized('Bad signature.');
    // Replays: each nonce once (after the signature, so strangers can't fill the store).
    const fresh = await this.redis.set(
      `nexaheart:fed:nonce:${from}:${nonce}`,
      '1',
      'EX',
      FEDERATION_NONCE_SECONDS,
      'NX',
    );
    if (fresh !== 'OK') throw unauthorized('This request was already received.');
    if (partner && partner.status !== 'ended') {
      await this.db
        .update(federationPartners)
        .set({ lastSeenAt: new Date(this.now()) })
        .where(eq(federationPartners.id, partner.id));
    }
    return { origin: from, partner: partner ?? null, identity };
  }

  /** A signed request from a community we're connected to (anything else is refused). */
  async verifyActive(incoming: IncomingSigned): Promise<PartnerRow> {
    const { partner } = await this.verify(incoming);
    if (!partner || partner.status !== 'active') {
      throw new HttpError(403, ErrorCode.Forbidden, 'Not connected.');
    }
    return partner;
  }

  /** Active partnerships (phase 28b). */
  async activePartners(): Promise<PartnerRow[]> {
    if (!this.enabled) return [];
    return this.db
      .select()
      .from(federationPartners)
      .where(eq(federationPartners.status, 'active'))
      .orderBy(federationPartners.activatedAt);
  }

  /** 28d: active or suspended: they still receive deletions (forget, unmatch, outcomes). */
  async reachablePartners(): Promise<PartnerRow[]> {
    if (!this.enabled) return [];
    return this.db
      .select()
      .from(federationPartners)
      .where(inArray(federationPartners.status, ['active', 'suspended']));
  }

  async activePartner(id: string): Promise<PartnerRow | null> {
    if (!this.enabled) return null;
    const [row] = await this.db
      .select()
      .from(federationPartners)
      .where(and(eq(federationPartners.id, id), eq(federationPartners.status, 'active')));
    return row ?? null;
  }

  /** Another community invites us: kept for our admin to decide. */
  async receiveInvitation(incoming: IncomingSigned): Promise<void> {
    const { origin, partner, identity } = await this.verify(incoming, true);
    if (partner && partner.status !== 'ended') {
      // We had invited them too: both sides want it, and both confirmed the agreement.
      if (partner.status === 'invited_out') await this.activate(partner.id);
      return;
    }
    // Anyone with a domain can sign an invitation: cap how many wait for the admin.
    const [waiting] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(federationPartners)
      .where(eq(federationPartners.status, 'invited_in'));
    if ((waiting?.n ?? 0) >= MAX_PENDING_INVITATIONS) {
      throw new HttpError(429, ErrorCode.RateLimited, 'Too many invitations are waiting.');
    }
    const id = identity ?? (await this.discover(origin));
    const values = {
      name: id.name,
      publicKey: id.publicKey,
      contact: id.contact,
      privacyUrl: id.privacyUrl,
      status: 'invited_in' as PartnerStatus,
      createdBy: null,
      createdAt: new Date(this.now()),
      activatedAt: null,
      endedAt: null,
      lastSeenAt: new Date(this.now()),
      lastError: null,
    };
    await this.db
      .insert(federationPartners)
      .values({ url: origin, ...values })
      .onConflictDoUpdate({ target: federationPartners.url, set: values });
    await audit(this.db, {
      actorId: null,
      action: 'federation.invited_in',
      targetType: 'partner',
      targetId: origin,
    });
  }

  async receiveAccept(incoming: IncomingSigned): Promise<void> {
    const { partner } = await this.verify(incoming);
    if (!partner || partner.status !== 'invited_out') {
      throw new HttpError(409, ErrorCode.Conflict, 'There is no invitation to accept.');
    }
    await this.activate(partner.id);
  }

  async receiveEnd(incoming: IncomingSigned): Promise<void> {
    const { partner } = await this.verify(incoming);
    if (partner) await this.markEnded(partner.id, null);
  }

  // ------------------------------------------------------------------ admins

  async list(): Promise<PartnersResponse> {
    const reason = !this.deps.on ? 'off' : !this.deps.sealKey ? 'no_key' : null;
    const rows = await this.db
      .select()
      .from(federationPartners)
      .orderBy(desc(federationPartners.createdAt));
    const sent = await this.db
      .select({
        id: federationReportsOut.partnerId,
        n: sql<number>`count(*)::int`,
        reviewed: sql<number>`count(${federationReportsOut.reviewedAt})::int`,
      })
      .from(federationReportsOut)
      .groupBy(federationReportsOut.partnerId);
    const received = await this.db
      .select({ id: reports.partnerId, n: sql<number>`count(*)::int` })
      .from(reports)
      .where(isNotNull(reports.partnerId))
      .groupBy(reports.partnerId);
    const waiting = await this.db
      .select({ id: federationOutbox.partnerId, n: sql<number>`count(*)::int` })
      .from(federationOutbox)
      .groupBy(federationOutbox.partnerId);
    const counts = (id: string) => {
      const s = sent.find((x) => x.id === id);
      return {
        reports: {
          sent: s?.n ?? 0,
          reviewed: s?.reviewed ?? 0,
          received: received.find((x) => x.id === id)?.n ?? 0,
        },
        outbox: waiting.find((x) => x.id === id)?.n ?? 0,
      };
    };
    const self = reason === null ? await this.identity() : null;
    const [keyRow] = self
      ? await this.db
          .select({ rotatedAt: federationKeys.rotatedAt })
          .from(federationKeys)
          .where(eq(federationKeys.id, 1))
      : [];
    const [announcing] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(federationOutbox)
      .where(eq(federationOutbox.signWithPrevious, true));
    return {
      enabled: reason === null,
      reason,
      self,
      key: self
        ? { rotatedAt: keyRow?.rotatedAt?.toISOString() ?? null, waiting: announcing?.n ?? 0 }
        : null,
      partners: rows.map((r) => ({ ...toPartner(r), ...counts(r.id) })),
    };
  }

  /** Invites another community (the admin confirmed the agreement is signed ⚖️). */
  async invite(actorId: string, url: string): Promise<PartnersResponse> {
    this.requireEnabled();
    const target = originOf(url);
    if (target === this.self)
      throw new HttpError(422, ErrorCode.ValidationError, 'That’s this community.');
    const [existing] = await this.db
      .select()
      .from(federationPartners)
      .where(and(eq(federationPartners.url, target), ne(federationPartners.status, 'ended')));
    if (existing) {
      throw new HttpError(409, ErrorCode.Conflict, 'This community is already in the list.');
    }
    const identity = await this.discover(target);
    const values = {
      name: identity.name,
      publicKey: identity.publicKey,
      contact: identity.contact,
      privacyUrl: identity.privacyUrl,
      status: 'invited_out' as PartnerStatus,
      createdBy: actorId,
      createdAt: new Date(this.now()),
      activatedAt: null,
      endedAt: null,
      lastSeenAt: null,
      lastError: null,
    };
    const [row] = await this.db
      .insert(federationPartners)
      .values({ url: target, ...values })
      .onConflictDoUpdate({ target: federationPartners.url, set: values })
      .returning({ id: federationPartners.id });
    try {
      await this.send(target, 'POST', '/v1/federation/invitations', {
        version: FEDERATION_VERSION,
      });
    } catch (error) {
      await this.db.delete(federationPartners).where(eq(federationPartners.id, row!.id));
      throw error;
    }
    await audit(this.db, {
      actorId,
      action: 'federation.invite',
      targetType: 'partner',
      targetId: target,
    });
    return this.list();
  }

  /** Accepts an invitation (the admin confirmed the agreement is signed ⚖️). */
  async accept(actorId: string, id: string): Promise<PartnersResponse> {
    this.requireEnabled();
    const partner = await this.partner(id);
    if (partner.status !== 'invited_in') {
      throw new HttpError(409, ErrorCode.Conflict, 'There is no invitation to accept.');
    }
    await this.send(partner.url, 'POST', '/v1/federation/accept', {});
    await this.activate(partner.id);
    await audit(this.db, {
      actorId,
      action: 'federation.accept',
      targetType: 'partner',
      targetId: partner.url,
    });
    return this.list();
  }

  /** Ends a partnership (or declines an invitation). The other side is told when it can be. */
  async end(actorId: string, id: string): Promise<PartnersResponse> {
    const partner = await this.partner(id);
    if (partner.status === 'ended') return this.list();
    let lastError: string | null = null;
    if (this.enabled) {
      await this.send(partner.url, 'POST', '/v1/federation/end', {}).catch((error: Error) => {
        lastError = error.message.slice(0, 200);
      });
    }
    await this.markEnded(partner.id, lastError);
    await audit(this.db, {
      actorId,
      action: 'federation.end',
      targetType: 'partner',
      targetId: partner.url,
    });
    return this.list();
  }

  /** A signed ping: proves both servers can reach and verify each other. */
  async test(actorId: string, id: string): Promise<PartnersResponse> {
    this.requireEnabled();
    const partner = await this.partner(id);
    if (partner.status !== 'active') {
      throw new HttpError(409, ErrorCode.Conflict, 'Only connected communities can be tested.');
    }
    let lastError: string | null = null;
    await this.send(partner.url, 'GET', '/v1/federation/ping').catch((error: Error) => {
      lastError = error.message.slice(0, 200);
    });
    await this.db
      .update(federationPartners)
      .set({ lastError, ...(lastError ? {} : { lastSeenAt: new Date(this.now()) }) })
      .where(eq(federationPartners.id, partner.id));
    await audit(this.db, {
      actorId,
      action: 'federation.test',
      targetType: 'partner',
      targetId: partner.url,
      meta: { ok: lastError === null },
    });
    return this.list();
  }

  /** 28d: pauses a partnership: nothing crosses either way, nothing is deleted. Admins only. */
  async suspend(actorId: string, id: string): Promise<PartnersResponse> {
    const partner = await this.partner(id);
    if (partner.status !== 'active') {
      throw new HttpError(409, ErrorCode.Conflict, 'Only connected communities can be suspended.');
    }
    await this.db
      .update(federationPartners)
      .set({ status: 'suspended' })
      .where(eq(federationPartners.id, id));
    await audit(this.db, {
      actorId,
      action: 'federation.suspend',
      targetType: 'partner',
      targetId: partner.url,
    });
    return this.list();
  }

  async resume(actorId: string, id: string): Promise<PartnersResponse> {
    const partner = await this.partner(id);
    if (partner.status !== 'suspended') {
      throw new HttpError(409, ErrorCode.Conflict, 'This partnership isn’t suspended.');
    }
    await this.db
      .update(federationPartners)
      .set({ status: 'active' })
      .where(eq(federationPartners.id, id));
    await audit(this.db, {
      actorId,
      action: 'federation.resume',
      targetType: 'partner',
      targetId: partner.url,
    });
    return this.list();
  }

  private async partner(id: string): Promise<PartnerRow> {
    const [row] = await this.db
      .select()
      .from(federationPartners)
      .where(eq(federationPartners.id, id));
    if (!row) throw notFound();
    return row;
  }

  private async activate(id: string): Promise<void> {
    await this.db
      .update(federationPartners)
      .set({ status: 'active', activatedAt: new Date(this.now()), lastError: null })
      .where(eq(federationPartners.id, id));
  }

  /** Ends a partnership; every alias, decision and match with that community is deleted. */
  private async markEnded(id: string, lastError: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(federationPartners)
        .set({ status: 'ended', endedAt: new Date(this.now()), lastError })
        .where(eq(federationPartners.id, id));
      await tx.delete(federationAliases).where(eq(federationAliases.partnerId, id));
      await tx.delete(federationDecisions).where(eq(federationDecisions.partnerId, id));
      await tx.delete(federationMatches).where(eq(federationMatches.partnerId, id));
      await tx.delete(federationOutbox).where(eq(federationOutbox.partnerId, id));
      await tx.delete(federationReportsOut).where(eq(federationReportsOut.partnerId, id));
    });
  }
}

function toPartner(r: PartnerRow): Omit<Partner, 'reports' | 'outbox'> {
  return {
    id: r.id,
    url: r.url,
    name: r.name,
    contact: r.contact,
    privacyUrl: r.privacyUrl,
    status: r.status as PartnerStatus,
    createdAt: r.createdAt.toISOString(),
    activatedAt: r.activatedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    lastError: r.lastError,
  };
}

/** Reads a response body, giving up (null) past `max` bytes: a partner can't flood us. */
async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done || !value) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export const FEDERATION_KEY_PATH = '/v1/federation/key';

/** What the new key signs to prove it belongs to whoever announces it. */
function keyProofParts(origin: string, publicKey: string, rotatedAt: Date) {
  return {
    method: 'KEY',
    path: FEDERATION_KEY_PATH,
    origin,
    date: rotatedAt.toISOString(),
    nonce: 'rotation',
    body: publicKey,
  };
}
