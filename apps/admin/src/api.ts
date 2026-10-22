// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type {
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
  ReportDetail,
  ReportSummary,
  StaffMe,
  VerificationReview,
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
  events: () => request<{ events: AdminEvent[] }>('GET', '/v1/admin/events'),
  createEvent: (input: EventInput) => request<AdminEvent>('POST', '/v1/admin/events', input),
  updateEvent: (id: string, patch: EventUpdate) =>
    request<AdminEvent>('PATCH', `/v1/admin/events/${encodeURIComponent(id)}`, patch),
  cancelEvent: (id: string) =>
    request<AdminEvent>('POST', `/v1/admin/events/${encodeURIComponent(id)}/cancel`),
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
  resolve: (id: string, action: ModerationAction, reason: string) =>
    request<{ ok: true }>('POST', `/v1/admin/reports/${encodeURIComponent(id)}/resolve`, {
      action,
      reason,
    }),
  unsuspend: (userId: string, reason: string) =>
    request<{ ok: true }>('POST', `/v1/admin/users/${encodeURIComponent(userId)}/unsuspend`, {
      reason,
    }),
  verifications: () =>
    request<{ verifications: VerificationReview[] }>('GET', '/v1/admin/verifications'),
  decide: (id: string, approve: boolean) =>
    request<{ ok: true }>('POST', `/v1/admin/verifications/${encodeURIComponent(id)}`, { approve }),
  audit: (before?: string) =>
    request<{ entries: AuditEntry[] }>(
      'GET',
      `/v1/admin/audit?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  photoPath: (userId: string, photoId: string) =>
    `/v1/admin/users/${encodeURIComponent(userId)}/photos/${encodeURIComponent(photoId)}`,
  selfiePath: (id: string) => `/v1/admin/verifications/${encodeURIComponent(id)}/selfie`,
};
