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
  FederationHeader,
  federationIdentitySchema,
  type FederationIdentity,
  type Partner,
  type PartnersResponse,
  type PartnerStatus,
} from '@nexaheart/shared';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
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

const { federationKeys, federationPartners } = schema;
type PartnerRow = typeof federationPartners.$inferSelect;

const KEY_CONTEXT = 'federation.privateKey';
/** Invitations from other communities waiting for an admin, at most. */
export const MAX_PENDING_INVITATIONS = 20;
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
 * communities, and signed requests between them. No member data crosses here.
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
  private async send(
    to: string,
    method: 'GET' | 'POST',
    path: string,
    payload?: object,
  ): Promise<unknown> {
    const { privateKey } = await this.keys();
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
      throw new HttpError(502, ErrorCode.BadGateway, `That community answered ${res.status}.`);
    }
    return res.json().catch(() => null);
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
    return {
      enabled: reason === null,
      reason,
      self: reason === null ? await this.identity() : null,
      partners: rows.map(toPartner),
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

  private async markEnded(id: string, lastError: string | null): Promise<void> {
    await this.db
      .update(federationPartners)
      .set({ status: 'ended', endedAt: new Date(this.now()), lastError })
      .where(eq(federationPartners.id, id));
  }
}

function toPartner(r: PartnerRow): Partner {
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
