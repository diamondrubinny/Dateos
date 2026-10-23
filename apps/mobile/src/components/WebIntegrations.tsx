// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { type PublicIntegrations, routePattern } from '@nexaheart/shared';
import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { apiFetch, json } from '../lib/api';
import { useInstance, useMe } from '../lib/queries';

type Analytics = NonNullable<PublicIntegrations['analytics']>;
type Queue = unknown[] & { push(...items: unknown[]): number };
declare global {
  interface Window {
    plausible?: ((event: string, options?: { u?: string }) => void) & { q?: unknown[] };
    umami?: { track(fn: (props: Record<string, unknown>) => Record<string, unknown>): void };
    _paq?: Queue;
  }
}

function addScript(src: string, attributes: Record<string, string> = {}) {
  if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) return;
  const script = document.createElement('script');
  script.src = src;
  script.defer = true;
  for (const [k, v] of Object.entries(attributes)) script.setAttribute(k, v);
  document.head.appendChild(script);
}

/** Loads the provider once, without automatic tracking: pages are sent by `track` below. */
function load(a: Analytics) {
  const url = a.url.replace(/\/+$/, '');
  if (a.provider === 'plausible') {
    window.plausible =
      window.plausible ??
      Object.assign((...args: unknown[]) => void (window.plausible!.q ??= []).push(args), {});
    addScript(`${url}/js/script.manual.js`, { 'data-domain': a.siteId });
  } else if (a.provider === 'umami') {
    addScript(`${url}/script.js`, { 'data-website-id': a.siteId, 'data-auto-track': 'false' });
  } else {
    const paq = (window._paq ??= [] as unknown as Queue);
    paq.push(['disableCookies']);
    paq.push(['setTrackerUrl', `${url}/matomo.php`]);
    paq.push(['setSiteId', a.siteId]);
    addScript(`${url}/matomo.js`);
  }
}

/** One page view: the route pattern only (/profile/[id]), never ids, names or query strings. */
function track(a: Analytics, pattern: string) {
  const page = `${window.location.origin}${pattern}`;
  if (a.provider === 'plausible') window.plausible?.('pageview', { u: page });
  else if (a.provider === 'umami') {
    window.umami?.track((props) => ({ ...props, url: pattern, title: pattern, referrer: '' }));
  } else {
    window._paq?.push(['setCustomUrl', page]);
    window._paq?.push(['setDocumentTitle', pattern]);
    window._paq?.push(['trackPageView']);
  }
}

/**
 * Integrations that run in the browser (phase 24):
 * - analytics, only for members who allowed it, with route patterns instead of addresses;
 * - error reports to this server, which scrubs and forwards them to error monitoring.
 * Nothing loads when the community hasn't set them up.
 */
export function WebIntegrations({ signedIn }: { signedIn: boolean }) {
  const integrations = useInstance().data?.integrations;
  const me = useMe(signedIn);
  const pathname = usePathname();
  const analytics = integrations?.analytics ?? null;
  const allowed = signedIn && me.data?.consents.analytics === true;
  const loaded = useRef(false);

  useEffect(() => {
    if (!analytics || !allowed) return;
    if (!loaded.current) {
      load(analytics);
      loaded.current = true;
    }
    track(analytics, routePattern(pathname));
  }, [analytics, allowed, pathname]);

  const webErrors = integrations?.webErrors ?? false;
  useEffect(() => {
    if (!webErrors) return;
    let sent = 0;
    const report = (message: string, stack?: string) => {
      // A few per page load are enough to see a problem.
      if (sent >= 5) return;
      sent += 1;
      void apiFetch('/v1/client-errors', {
        method: 'POST',
        body: json({
          message: message.slice(0, 500) || 'Error',
          ...(stack ? { stack: stack.slice(0, 4000) } : {}),
          route: routePattern(window.location.pathname),
        }),
      }).catch(() => undefined);
    };
    const onError = (e: ErrorEvent) => report(e.message, e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: string; stack?: string } | undefined;
      report(reason?.message ?? 'Unhandled rejection', reason?.stack);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [webErrors]);

  return null;
}
