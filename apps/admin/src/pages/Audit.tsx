import type { AuditEntry } from '@dateos/shared';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { useAsync } from '../hooks';
import { useLocale } from '../i18n';
import { ErrorBox, formatDate, Loading } from '../components/ui';

export function Audit() {
  const { t, locale } = useLocale();
  const [older, setOlder] = useState<AuditEntry[]>([]);
  const { data, error, loading, reload } = useAsync(() => api.audit(), []);
  const [loadingMore, setLoadingMore] = useState(false);
  const entries = [...(data?.entries ?? []), ...older];

  async function more() {
    const last = entries.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await api.audit(last.createdAt);
      setOlder((prev) => [...prev, ...page.entries]);
    } finally {
      setLoadingMore(false);
    }
  }

  if (error instanceof ApiError && error.status === 403) {
    return (
      <section aria-labelledby="audit-title">
        <h1 id="audit-title">{t.audit.title}</h1>
        <p>{t.audit.adminOnly}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="audit-title">
      <h1 id="audit-title">{t.audit.title}</h1>
      <p>{t.audit.intro}</p>
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {entries.length > 0 ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="audit-title">
          <table>
            <thead>
              <tr>
                <th scope="col">{t.audit.when}</th>
                <th scope="col">{t.audit.action}</th>
                <th scope="col">{t.audit.actor}</th>
                <th scope="col">{t.audit.target}</th>
                <th scope="col">{t.audit.meta}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.createdAt, locale)}</td>
                  <td>
                    <code dir="ltr">{e.action}</code>
                  </td>
                  <td>
                    <code dir="ltr">{e.actorId ?? t.audit.system}</code>
                  </td>
                  <td>
                    <code dir="ltr">
                      {e.targetType ? `${e.targetType}:${e.targetId ?? ''}` : '—'}
                    </code>
                  </td>
                  <td>
                    <code dir="ltr">
                      {e.meta
                        ? Object.entries(e.meta)
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(' ')
                        : ''}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {entries.length >= 50 ? (
        <button type="button" className="button" onClick={more} disabled={loadingMore}>
          {t.audit.more}
        </button>
      ) : null}
    </section>
  );
}
