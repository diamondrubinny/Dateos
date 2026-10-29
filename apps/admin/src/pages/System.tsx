// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { BACKUP_STALE_HOURS } from '@nexaheart/shared';
import { api } from '../api';
import { useAsync } from '../hooks';
import { useLocale } from '../i18n';
import { ErrorBox, Loading } from '../components/ui';
import { Updates } from './Updates';

/**
 * System (phase 51), admins only: is every part of the server up, and when did the last backup
 * finish. Status is always written out, never shown by colour alone.
 */
export function System() {
  const { t, locale } = useLocale();
  const { data, error, loading, reload } = useAsync(() => api.system(), []);
  const s = t.system;
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  const size = (bytes: number) =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(bytes / 1_000_000);

  return (
    <section aria-labelledby="system-title" data-testid="system">
      <h1 id="system-title">{s.title}</h1>
      <p>{s.intro}</p>
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <h2>{s.backupTitle}</h2>
          <div
            className={`alert ${data.backup.stale ? 'alert-error' : 'alert-ok'}`}
            role={data.backup.stale ? 'alert' : 'status'}
            data-testid="system-backup"
          >
            <p>
              <strong>
                {data.backup.lastAt === null
                  ? s.backupNever
                  : data.backup.stale
                    ? s.backupStale(BACKUP_STALE_HOURS)
                    : s.backupOk}
              </strong>
            </p>
            {data.backup.lastAt ? (
              <p>
                {s.backupLast(when(data.backup.lastAt))}
                {data.backup.bytes !== null ? ` · ${s.backupSize(size(data.backup.bytes))}` : ''}
              </p>
            ) : null}
            {data.backup.stale ? (
              <>
                <p>{s.backupHelp}</p>
                <ul>
                  {(
                    [
                      [s.backupCron, '/etc/cron.d/nexaheart-backup'],
                      [s.backupLog, '/var/log/nexaheart-backup.log'],
                      [s.backupRun, 'cd /opt/nexaheart && ./scripts/backup.sh'],
                    ] as const
                  ).map(([label, value]) => (
                    <li key={label}>
                      {label}: <code dir="ltr">{value}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <h2>{s.checksTitle}</h2>
          <p className={data.status === 'ready' ? '' : 'field-error'}>
            {data.status === 'ready' ? s.allUp : s.someDown}
          </p>
          <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="system-checks">
            <table>
              <caption id="system-checks">{s.checksTitle}</caption>
              <thead>
                <tr>
                  <th scope="col">{s.part}</th>
                  <th scope="col">{s.state}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.checks).map(([name, state]) => (
                  <tr key={name}>
                    <th scope="row">{s.parts[name as keyof typeof s.parts] ?? name}</th>
                    <td>
                      <span className={`badge ${state === 'up' ? 'badge-ok' : 'badge-urgent'}`}>
                        {state === 'up' ? s.up : s.down}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="button" onClick={reload}>
            {s.refresh}
          </button>
          <Updates />
        </>
      ) : null}
    </section>
  );
}
