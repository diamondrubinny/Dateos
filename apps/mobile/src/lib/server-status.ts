// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Whether the community's server answers (phase 55). An update or a restart makes it unreachable
 * for a minute or two: requests fail without an answer (network) or with a proxy's 502/503/504.
 * That isn't "signed out", and shouldn't look like it.
 */
let unavailable = false;
const listeners = new Set<() => void>();
const set = (value: boolean) => {
  if (unavailable === value) return;
  unavailable = value;
  for (const listener of listeners) listener();
};

export const markUnavailable = () => set(true);
export const markAvailable = () => set(false);
export const isServerUnavailable = () => unavailable;

export function useServerUnavailable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => unavailable,
    () => false,
  );
}

/** HTTP statuses a proxy answers with while the API is restarting. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * Whether an answer means the server itself didn't answer: no answer at all (status 0), a proxy's
 * 502/503/504 without an API error in it, or the proxy's own SERVER_RESTARTING. An error the API
 * sent (a feature that's off: 503 SERVICE_UNAVAILABLE; a partner community down: 502
 * BAD_GATEWAY) carries its code and is not an outage.
 */
export function isUnavailableAnswer(status: number, code: string | undefined): boolean {
  if (status === 0) return true;
  if (code === 'SERVER_RESTARTING') return true;
  return GATEWAY_STATUSES.has(status) && !code;
}

/**
 * The same for a thrown error: our ApiRequestError, or better-auth's fetch errors (a failed fetch
 * has no status; an HTTP error has `status` and the body's fields).
 */
export function isUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; code?: unknown; error?: { code?: unknown } };
  if (typeof e.status !== 'number') return true;
  const code =
    typeof e.code === 'string' && e.code !== 'NETWORK_ERROR'
      ? e.code
      : typeof e.error?.code === 'string'
        ? e.error.code
        : undefined;
  return isUnavailableAnswer(e.status, code);
}

/** How often to ask the server whether it's back while it isn't answering. */
export const HEALTH_POLL_MS = 10_000;

/**
 * While `active`, asks the API's public health check every HEALTH_POLL_MS (no cookie, nothing
 * about the member) and calls `onBack` once it answers.
 */
export function useHealthPoll(active: boolean, apiUrl: string, onBack: () => void): void {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const timer = setInterval(() => {
      void fetch(`${apiUrl}/health`, { cache: 'no-store', credentials: 'omit' })
        .then((res) => {
          if (res.ok && !stopped) {
            markAvailable();
            back.current();
          }
        })
        .catch(() => undefined);
    }, HEALTH_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, apiUrl]);
}
