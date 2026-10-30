// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { API_URL, ApiError, fetchImage, isUnreachable } from '../api';
import { useLocale } from '../i18n';

export function Loading() {
  const { t } = useLocale();
  return (
    <p className="muted" role="status">
      {t.loading}
    </p>
  );
}

/** How often the dashboard asks whether the server is back (phase 55). */
const HEALTH_POLL_MS = 10_000;

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { t } = useLocale();
  const unreachable = isUnreachable(error);
  const retry = useRef(onRetry);
  retry.current = onRetry;
  // While the server doesn't answer (an update, a restart), ask its public health check and carry
  // on by itself when it's back.
  useEffect(() => {
    if (!unreachable) return;
    const timer = setInterval(() => {
      void fetch(`${API_URL}/health`, { cache: 'no-store', credentials: 'omit' })
        .then((res) => {
          if (res.ok) retry.current?.();
        })
        .catch(() => undefined);
    }, HEALTH_POLL_MS);
    return () => clearInterval(timer);
  }, [unreachable]);
  if (unreachable) {
    return (
      <div className="alert alert-info" role="status" data-testid="server-unreachable">
        <p>
          <strong>{t.unreachable.title}</strong>
        </p>
        <p>{t.unreachable.body}</p>
        {onRetry ? (
          <button type="button" className="button" onClick={onRetry}>
            {t.retry}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="alert alert-error" role="alert">
      <p>
        {error instanceof ApiError && error.status === 429
          ? t.rateLimited
          : error instanceof ApiError && error.status < 500 && error.status > 0
            ? error.message
            : t.error}
      </p>
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          {t.retry}
        </button>
      ) : null}
    </div>
  );
}

/** Private images are fetched with the session cookie and shown from a local object URL. */
export function ProtectedImage({
  path,
  alt,
  className,
}: {
  path: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | undefined;
    let active = true;
    fetchImage(path)
      .then((u) => {
        objectUrl = u;
        if (active) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  if (failed)
    return (
      <div className={`image-placeholder ${className ?? ''}`} role="img" aria-label={alt}>
        ×
      </div>
    );
  if (!url)
    return (
      <div
        className={`image-placeholder ${className ?? ''}`}
        role="img"
        aria-label={alt}
        aria-busy="true"
      />
    );
  return <img src={url} alt={alt} className={className} />;
}

/** Private audio (voice evidence), loaded with the session cookie into a local object URL. */
export function ProtectedAudio({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const load = () => {
    // Opus for browsers that cannot play AAC.
    const aac = new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"') !== '';
    fetchImage(aac ? path : `${path}?format=opus`)
      .then(setUrl)
      .catch(() => setFailed(true));
  };
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (failed) return <span className="muted">×</span>;
  // Loaded on demand: each play is audited on the server.
  if (!url) {
    return (
      <button type="button" className="button small" onClick={load}>
        ▶ {label}
      </button>
    );
  }
  return <audio controls autoPlay src={url} aria-label={label} />;
}

export function Badge({
  tone,
  children,
}: {
  tone: 'urgent' | 'high' | 'normal' | 'ok' | 'muted';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
