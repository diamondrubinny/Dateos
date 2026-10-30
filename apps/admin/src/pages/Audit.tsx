// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { AuditEntry } from '@nexaheart/shared';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { useAsync } from '../hooks';
import { useLocale } from '../i18n';
import { ErrorBox, formatDate, Loading } from '../components/ui';

export function Audit() {
  const { t, locale } = useLocale();
  const [older, setOlder] = useState<AuditEntry[]>([]);
  // Phase 64: who looked at member data.
  const [staffOnly, setStaffOnly] = useState(false);
  const only = staffOnly ? ('staff_access' as const) : undefined;
  const { data, error, loading, reload } = useAsync(() => api.audit(undefined, only), [only]);
  const [loadingMore, setLoadingMore] = useState(false);
  const entries = [...(data?.entries ?? []), ...older];

  async function more() {
    const last = entries.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await api.audit(last.createdAt, only);
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
      <div className="checkbox">
        <input
          type="checkbox"
          id="audit-staff-only"
          checked={staffOnly}
          aria-describedby="audit-staff-only-help"
          onChange={(e) => {
            setOlder([]);
            setStaffOnly(e.target.checked);
          }}
        />
        <label htmlFor="audit-staff-only">{t.audit.staffOnly}</label>
        <p id="audit-staff-only-help" className="help">
          {t.audit.staffOnlyHelp}
        </p>
      </div>
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
