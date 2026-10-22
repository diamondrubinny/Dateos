import { useState } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { useLocale } from '../i18n';
import { Badge, ErrorBox, formatDate, Loading } from '../components/ui';

export function Reports() {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const { data, error, loading, reload } = useAsync(() => api.reports(status), [status]);

  return (
    <section aria-labelledby="reports-title">
      <h1 id="reports-title">{t.reports.title}</h1>
      <div className="segmented" role="group" aria-label={t.reports.status}>
        {(['open', 'closed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s === 'open' ? t.reports.open : t.reports.closed}
          </button>
        ))}
      </div>
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {data && data.reports.length === 0 ? <p className="empty">{t.reports.empty}</p> : null}
      {data && data.reports.length > 0 ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="reports-title">
          <table>
            <thead>
              <tr>
                <th scope="col">{t.reports.priority}</th>
                <th scope="col">{t.reports.category}</th>
                <th scope="col">{t.reports.reported}</th>
                <th scope="col">{t.reports.openAgainst}</th>
                <th scope="col">{t.reports.evidence}</th>
                <th scope="col">{t.reports.received}</th>
                <th scope="col">
                  <span className="visually-hidden">{t.reports.view}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Badge tone={r.priority}>{t.priorities[r.priority]}</Badge>
                  </td>
                  <td>{t.categories[r.category]}</td>
                  <td>
                    <bdi>{r.reported.displayName ?? '—'}</bdi>
                    {r.reported.status !== 'active' ? (
                      <>
                        {' '}
                        <Badge tone="muted">
                          {t.statuses[r.reported.status as 'active'] ?? r.reported.status}
                        </Badge>
                      </>
                    ) : null}
                  </td>
                  <td>{r.openReportsAgainst}</td>
                  <td>{r.evidenceCount}</td>
                  <td>{formatDate(r.createdAt, locale)}</td>
                  <td>
                    <a className="button small" href={`#/reports/${r.id}`}>
                      {t.reports.view}
                      <span className="visually-hidden">
                        {' '}
                        {t.categories[r.category]}, {r.reported.displayName ?? ''}
                      </span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
