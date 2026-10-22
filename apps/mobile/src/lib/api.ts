import { apiErrorSchema, type ApiError, type ErrorCode } from '@nexaheart/shared';
import { Platform } from 'react-native';
import { authHeaders } from './auth-client';
import { API_URL } from './config';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: Platform.OS === 'web' ? 'include' : 'omit',
      headers: {
        accept: 'application/json',
        ...(init.body && !isForm ? { 'content-type': 'application/json' } : {}),
        ...(await authHeaders()),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Network request failed');
  }
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    const error: ApiError['error'] | undefined = parsed.success ? parsed.data.error : undefined;
    throw new ApiRequestError(
      res.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? res.statusText,
    );
  }
  return body as T;
}

export const json = (value: unknown): RequestInit['body'] => JSON.stringify(value);

/** Absolute URL for an API-relative media path such as /v1/photos/{id}. */
export function mediaUrl(path: string): string {
  return `${API_URL}${path}`;
}
