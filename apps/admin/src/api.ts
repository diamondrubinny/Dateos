// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type {
  SystemStatus,
  UpdateStatusView,
  AdminCheckIn,
  IntegrationId,
  IntegrationUpdate,
  IntegrationView,
  AdminEvent,
  EventInput,
  EventUpdate,
  AdminVenue,
  VenueInput,
  VenueUpdate,
  AuditEntry,
  InstanceInfo,
  InstanceSettingsInput,
  ModerationAction,
  ModerationGround,
  IdentityVocabulary,
  Intention,
  Gender,
  AppealSummary,
  ReportDetail,
  ReportSummary,
  StaffMe,
  VerificationReview,
  CreateInviteInput,
  Invite,
  SignupMode,
  WaitlistEntry,
  WaitlistStatus,
  EventBoard,
  PartnersResponse,
  SafetyOverview,
} from '@nexaheart/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export const MFA_REQUIRED_EVENT = 'nexaheart:mfa-required';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Phase 55: the server didn't answer (an update, a restart): no answer at all, a proxy's
 * 502/503/504 without an API error in it, or the proxy's own SERVER_RESTARTING. An error the API
 * itself sent (a feature that's off, a partner community down) is not this.
 */
export function isUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0 || error.code === 'SERVER_RESTARTING') return true;
  return [502, 503, 504].includes(error.status) && error.code === 'UNKNOWN';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached.');
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const code = payload?.error?.code ?? 'UNKNOWN';
    // The 12-hour step-up expired: the app shell asks for a new code.
    if (code === 'MFA_REQUIRED') window.dispatchEvent(new Event(MFA_REQUIRED_EVENT));
    throw new ApiError(res.status, code, payload?.error?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

/** Fetches a protected image with the session cookie and returns an object URL. */
export async function fetchImage(path: string): Promise<string> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'IMAGE', res.statusText);
  return URL.createObjectURL(await res.blob());
}

export interface AdminInstanceSettings {
  name: string;
  tagline: string;
  primaryColor: string;
  defaultLocale: 'he' | 'en' | 'ar' | 'ru';
  operatorName: string | null;
  contactEmail: string | null;
  sponsorUrl: string | null;
  logoUrl: string | null;
  setupCompleted: boolean;
  callsConfigured: boolean;
  callsEnabled: boolean;
  callMaxMinutes: number;
  signupMode: SignupMode;
  memberInvites: boolean;
  identityVocabulary: IdentityVocabulary;
  identityCustom: boolean;
  identityPronouns: boolean;
  intentionsOffered: Intention[];
  faithModule: boolean;
  joinMinAge: number;
  joinMaxAge: number | null;
  joinGenders: Gender[];
  joinDeclaration: string | null;
  ageCheckConfigured: boolean;
  ageCheckRequired: boolean;
}

async function upload(path: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? res.statusText,
    );
  }
}

export const api = {
  instance: () => request<InstanceInfo>('GET', '/v1/instance'),
  claim: (token: string) => request<{ ok: true }>('POST', '/v1/setup/claim', { token }),
  settings: () => request<AdminInstanceSettings>('GET', '/v1/admin/instance'),
  saveSettings: (input: InstanceSettingsInput) =>
    request<AdminInstanceSettings>('PATCH', '/v1/admin/instance', input),
  uploadLogo: (file: File) => upload('/v1/admin/instance/logo', file),
  removeLogo: () => request<{ ok: true }>('DELETE', '/v1/admin/instance/logo'),
  venues: () => request<{ venues: AdminVenue[] }>('GET', '/v1/admin/venues'),
  invites: () => request<{ invites: Invite[] }>('GET', '/v1/admin/invites'),
  createInvite: (input: CreateInviteInput) => request<Invite>('POST', '/v1/admin/invites', input),
  revokeInvite: (id: string) =>
    request<{ ok: true }>('POST', `/v1/admin/invites/${encodeURIComponent(id)}/revoke`),
  waitlist: (status: WaitlistStatus) =>
    request<{ entries: WaitlistEntry[] }>('GET', `/v1/admin/waitlist?status=${status}`),
  decideWaitlist: (id: string, approve: boolean) =>
    request<{ ok: true }>(
      'POST',
      `/v1/admin/waitlist/${encodeURIComponent(id)}/${approve ? 'approve' : 'decline'}`,
    ),
  events: () => request<{ events: AdminEvent[] }>('GET', '/v1/admin/events'),
  createEvent: (input: EventInput) => request<AdminEvent>('POST', '/v1/admin/events', input),
  updateEvent: (id: string, patch: EventUpdate) =>
    request<AdminEvent>('PATCH', `/v1/admin/events/${encodeURIComponent(id)}`, patch),
  cancelEvent: (id: string) =>
    request<AdminEvent>('POST', `/v1/admin/events/${encodeURIComponent(id)}/cancel`),
  integrations: () =>
    request<{ integrations: IntegrationView[]; editable: boolean }>(
      'GET',
      '/v1/admin/integrations',
    ),
  saveIntegration: (id: IntegrationId, update: IntegrationUpdate) =>
    request<IntegrationView>('PUT', `/v1/admin/integrations/${id}`, update),
  testIntegration: (id: IntegrationId) =>
    request<{ ok: boolean; message: string }>('POST', `/v1/admin/integrations/${id}/test`),
  removeIntegration: (id: IntegrationId) =>
    request<IntegrationView>('DELETE', `/v1/admin/integrations/${id}`),
  webhookDeliveries: () =>
    request<{
      deliveries: {
        id: string;
        event: string;
        status: number | null;
        ok: boolean;
        attempt: number;
        at: string;
      }[];
    }>('GET', '/v1/admin/webhooks/deliveries'),
  eventBoard: (id: string) =>
    request<EventBoard>('GET', `/v1/admin/events/${encodeURIComponent(id)}/board`),
  postEventUpdate: (id: string, body: string) =>
    request<EventBoard>('POST', `/v1/admin/events/${encodeURIComponent(id)}/updates`, { body }),
  deleteEventUpdate: (id: string, updateId: string) =>
    request<EventBoard>(
      'DELETE',
      `/v1/admin/events/${encodeURIComponent(id)}/updates/${encodeURIComponent(updateId)}`,
    ),
  answerEventQuestion: (id: string, questionId: string, answer: string) =>
    request<EventBoard>(
      'POST',
      `/v1/admin/events/${encodeURIComponent(id)}/questions/${encodeURIComponent(questionId)}/answer`,
      { answer },
    ),
  partners: () => request<PartnersResponse>('GET', '/v1/admin/partners'),
  invitePartner: (url: string) =>
    request<PartnersResponse>('POST', '/v1/admin/partners', { url, agreementConfirmed: true }),
  acceptPartner: (id: string) =>
    request<PartnersResponse>('POST', `/v1/admin/partners/${encodeURIComponent(id)}/accept`, {
      agreementConfirmed: true,
    }),
  endPartner: (id: string) =>
    request<PartnersResponse>('POST', `/v1/admin/partners/${encodeURIComponent(id)}/end`),
  testPartner: (id: string) =>
    request<PartnersResponse>('POST', `/v1/admin/partners/${encodeURIComponent(id)}/test`),
  rotateFederationKey: () => request<PartnersResponse>('POST', '/v1/admin/federation/rotate-key'),
  suspendPartner: (id: string) =>
    request<PartnersResponse>('POST', `/v1/admin/partners/${encodeURIComponent(id)}/suspend`),
  resumePartner: (id: string) =>
    request<PartnersResponse>('POST', `/v1/admin/partners/${encodeURIComponent(id)}/resume`),
  checkIn: (id: string) =>
    request<AdminCheckIn>('GET', `/v1/admin/events/${encodeURIComponent(id)}/check-in`),
  createVenue: (input: Omit<VenueInput, 'active'>) =>
    request<AdminVenue>('POST', '/v1/admin/venues', input),
  updateVenue: (id: string, patch: VenueUpdate) =>
    request<AdminVenue>('PATCH', `/v1/admin/venues/${encodeURIComponent(id)}`, patch),
  me: () => request<StaffMe>('GET', '/v1/admin/me'),
  requestLink: (email: string, callbackURL: string) =>
    request<unknown>('POST', '/v1/auth/sign-in/magic-link', { email, callbackURL }),
  signOut: () => request<unknown>('POST', '/v1/auth/sign-out', {}),
  mfaSetup: () => request<{ secret: string; otpauthUrl: string }>('POST', '/v1/admin/mfa/setup'),
  mfaVerify: (code: string) => request<{ ok: true }>('POST', '/v1/admin/mfa/verify', { code }),
  reports: (status: 'open' | 'closed') =>
    request<{ reports: ReportSummary[] }>('GET', `/v1/admin/reports?status=${status}`),
  report: (id: string) =>
    request<ReportDetail>('GET', `/v1/admin/reports/${encodeURIComponent(id)}`),
  resolve: (
    id: string,
    action: ModerationAction,
    reason: string,
    statement: { ground: ModerationGround; explanation?: string },
  ) =>
    request<{ ok: true }>('POST', `/v1/admin/reports/${encodeURIComponent(id)}/resolve`, {
      action,
      reason,
      ...statement,
    }),
  appeals: (status: 'open' | 'closed') =>
    request<{ appeals: AppealSummary[] }>('GET', `/v1/admin/appeals?status=${status}`),
  decideAppeal: (id: string, reverse: boolean, response: string) =>
    request<{ ok: true }>('POST', `/v1/admin/appeals/${encodeURIComponent(id)}/decide`, {
      reverse,
      response,
    }),
  unsuspend: (userId: string, reason: string) =>
    request<{ ok: true }>('POST', `/v1/admin/users/${encodeURIComponent(userId)}/unsuspend`, {
      reason,
    }),
  verifications: () =>
    request<{ verifications: VerificationReview[] }>('GET', '/v1/admin/verifications'),
  decide: (id: string, approve: boolean) =>
    request<{ ok: true }>('POST', `/v1/admin/verifications/${encodeURIComponent(id)}`, { approve }),
  overview: () => request<SafetyOverview>('GET', '/v1/admin/overview'),
  system: () => request<SystemStatus>('GET', '/v1/admin/system'),
  updates: () => request<UpdateStatusView>('GET', '/v1/admin/updates'),
  checkUpdates: () => request<UpdateStatusView>('POST', '/v1/admin/updates/check'),
  /** Phase 56: `at` (ISO) installs at that time; without it, as soon as possible. */
  installUpdate: (commit: string, at?: string) =>
    request<UpdateStatusView>(
      'POST',
      '/v1/admin/updates/install',
      at ? { commit, at } : { commit },
    ),
  cancelUpdate: (id: string) =>
    request<UpdateStatusView>('POST', `/v1/admin/updates/${encodeURIComponent(id)}/cancel`),
  audit: (before?: string) =>
    request<{ entries: AuditEntry[] }>(
      'GET',
      `/v1/admin/audit?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  photoPath: (userId: string, photoId: string) =>
    `/v1/admin/users/${encodeURIComponent(userId)}/photos/${encodeURIComponent(photoId)}`,
  selfiePath: (id: string) => `/v1/admin/verifications/${encodeURIComponent(id)}/selfie`,
};
