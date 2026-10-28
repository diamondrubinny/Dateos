// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { reportCategories, reportPriorities } from '@nexaheart/shared';
import { api } from '../api';
import { useAsync } from '../hooks';
import { useLocale } from '../i18n';
import { ErrorBox, Loading } from '../components/ui';

/**
 * Overview (phase 36): how the safety queue is doing, in counts only. Tables with headings, so
 * screen readers get every number with its meaning.
 */
export function Overview() {
  const { t, locale } = useLocale();
  const { data, error, loading, reload } = useAsync(() => api.overview(), []);
  const o = t.overview;
  const num = (n: number) => n.toLocaleString(locale);
  const hours = (n: number | null) => (n === null ? o.none : o.hours(n));

  const table = (id: string, caption: string, rows: [string, string][]) => (
    <div className="table-wrap" tabIndex={0} role="region" aria-labelledby={id}>
      <table>
        <caption id={id}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{o.metric}</th>
            <th scope="col">{o.count}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section aria-labelledby="overview-title" data-testid="overview">
      <h1 id="overview-title">{o.title}</h1>
      <p>{o.intro}</p>
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <h2>{o.queue}</h2>
          {table('overview-open', o.queue, [
            [o.total, num(data.open.total)],
            [o.oldest, hours(data.open.oldestHours)],
            [o.verificationsWaiting, num(data.verificationsWaiting)],
          ])}
          {table(
            'overview-priority',
            o.byPriority,
            reportPriorities.map((p) => [t.priorities[p], num(data.open.byPriority[p] ?? 0)]),
          )}
          {table(
            'overview-category',
            o.byCategory,
            reportCategories
              .filter((c) => data.open.byCategory[c])
              .map((c) => [t.categories[c], num(data.open.byCategory[c]!)]),
          )}

          <h2>{o.recent(data.recent.days)}</h2>
          {table('overview-recent', o.recent(data.recent.days), [
            [o.fromMembers, num(data.recent.fromMembers)],
            [o.automatic, num(data.recent.automatic)],
            [o.resolved, num(data.recent.resolved)],
            [o.median, hours(data.recent.medianResolveHours)],
            [o.newAccounts, num(data.recent.newAccounts)],
            [o.suspensions, num(data.recent.suspensions)],
          ])}
          {Object.keys(data.recent.automaticByReason).length > 0 ? (
            table(
              'overview-reasons',
              o.byReason,
              Object.entries(data.recent.automaticByReason).map(([reason, n]) => [
                o.reasons[reason] ?? reason,
                num(n),
              ]),
            )
          ) : (
            <p>{o.noAutomatic}</p>
          )}
        </>
      ) : null}
    </section>
  );
}
