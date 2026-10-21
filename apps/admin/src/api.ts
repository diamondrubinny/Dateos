import type {
  AuditEntry,
  ModerationAction,
  ReportDetail,
  ReportSummary,
  StaffMe,
  VerificationReview,
} from '@dateos/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export const MFA_REQUIRED_EVENT = 'dateos:mfa-required';

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

export const api = {
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
