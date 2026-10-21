import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, fetchImage } from '../api';
import { useLocale } from '../i18n';

export function Loading() {
  const { t } = useLocale();
  return (
    <p className="muted" role="status">
      {t.loading}
    </p>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { t } = useLocale();
  return (
    <div className="alert alert-error" role="alert">
      <p>
        {error instanceof ApiError && error.status === 429
          ? t.rateLimited
          : error instanceof ApiError && error.status < 500
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
