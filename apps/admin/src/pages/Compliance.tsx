// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  complianceTemplates,
  incidentKinds,
  incidentSeverities,
  transparencyCsv,
  type ComplianceTemplate,
  type Incident,
  type IncidentKind,
  type IncidentSeverity,
  type TransparencyReport,
} from '@nexaheart/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { useLocale } from '../i18n';
import { Badge, ErrorBox, formatDate, Loading } from '../components/ui';

/** Saves text as a file the browser downloads. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const day = (d: Date) => d.toISOString().slice(0, 10);
/** A datetime-local value (the admin's time zone) as an ISO instant, or null. */
const instant = (v: string) => (v ? new Date(v).toISOString() : null);

/** Phase 64, Dashboard → Compliance (admins): transparency report, incidents, documents. ⚖️ 📘 */
export function Compliance() {
  const { t } = useLocale();
  return (
    <section aria-labelledby="compliance-title">
      <h1 id="compliance-title">{t.compliance.title}</h1>
      <p>{t.compliance.intro}</p>
      <Transparency />
      <Incidents />
      <Templates />
    </section>
  );
}

function Transparency() {
  const { t } = useLocale();
  const c = t.compliance;
  const id = useId();
  const today = new Date();
  const [from, setFrom] = useState(day(new Date(today.getTime() - 182 * 86_400_000)));
  const [to, setTo] = useState(day(today));
  const [report, setReport] = useState<TransparencyReport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();

  async function show(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setReport(await api.transparency(from, to));
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, number | string | null][] = report
    ? [
        [c.notices, report.notices.total],
        ...Object.entries(report.notices.bySource).map(
          ([k, v]) => [`· ${c.sources[k as keyof typeof c.sources]}`, v] as [string, number],
        ),
        ...Object.entries(report.notices.byCategory)
          .filter(([, v]) => v > 0)
          .map(
            ([k, v]) =>
              [`· ${t.categories[k as keyof typeof t.categories]}`, v] as [string, number],
          ),
        [c.closedActioned, report.notices.closed.actioned],
        [c.closedDismissed, report.notices.closed.dismissed],
        [c.medianHours, report.notices.medianHoursToDecision],
        [c.decisions, report.decisions.total],
        ...Object.entries(report.decisions.byAction).map(
          ([k, v]) => [`· ${t.actions[k as keyof typeof t.actions]}`, v] as [string, number],
        ),
        [`· ${t.detail.groundTerms}`, report.decisions.byGround.terms],
        [`· ${t.detail.groundIllegal}`, report.decisions.byGround.illegal],
        [c.automated, report.decisions.automatedDetection],
        [c.reversed, report.decisions.reversed],
        [c.appeals, report.appeals.received],
        [`· ${t.appeals.status.upheld}`, report.appeals.byStatus.upheld],
        [`· ${t.appeals.status.reversed}`, report.appeals.byStatus.reversed],
        [`· ${c.open}`, report.appeals.byStatus.open],
        [c.medianDays, report.appeals.medianDaysToDecide],
        [c.underage, report.underageSuspensions],
        [c.active, report.membersActiveLast30Days],
      ]
    : [];

  return (
    <form className="card" onSubmit={show} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{c.reportTitle}</h2>
      <p className="help">{c.reportIntro}</p>
      <div className="time-row">
        <div>
          <label htmlFor={`${id}-from`}>{c.from}</label>
          <input
            id={`${id}-from`}
            type="date"
            required
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-to`}>{c.to}</label>
          <input
            id={`${id}-to`}
            type="date"
            required
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      <div className="actions">
        <button type="submit" className="button primary" disabled={busy}>
          {c.show}
        </button>
        {report ? (
          <>
            <button
              type="button"
              className="button"
              onClick={() =>
                download(
                  `transparency-${report.period.from}-${report.period.to}.csv`,
                  transparencyCsv(report),
                  'text/csv',
                )
              }
            >
              {c.csv}
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                download(
                  `transparency-${report.period.from}-${report.period.to}.json`,
                  `${JSON.stringify(report, null, 2)}\n`,
                  'application/json',
                )
              }
            >
              {c.json}
            </button>
          </>
        ) : null}
      </div>
      {report ? (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-labelledby={`${id}-table`}>
            <table>
              <caption id={`${id}-table`}>
                {c.reportFor} <bdi dir="ltr">{report.period.from}</bdi> –{' '}
                <bdi dir="ltr">{report.period.to}</bdi>
              </caption>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{value ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help">{c.retention}</p>
        </>
      ) : null}
    </form>
  );
}

const severityTone: Record<IncidentSeverity, 'urgent' | 'high' | 'normal' | 'muted'> = {
  severe: 'urgent',
  high: 'high',
  medium: 'normal',
  low: 'muted',
};

function Incidents() {
  const { t, locale } = useLocale();
  const c = t.compliance;
  const { data, error, loading, reload } = useAsync(() => api.incidents(), []);
  const [notice, setNotice] = useState<string>();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const done = (message: string) => {
    setNotice(message);
    reload();
    statusRef.current?.focus();
  };

  return (
    <div className="card">
      <h2 id="incidents-title">{c.incidentsTitle}</h2>
      <p className="help">{c.incidentsIntro}</p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={notice ? 'alert alert-ok' : 'visually-hidden'}
      >
        {notice ?? ''}
      </p>
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {data && data.incidents.length === 0 ? <p className="empty">{c.noIncidents}</p> : null}
      {data?.incidents.map((incident) => (
        <IncidentItem
          key={incident.id}
          incident={incident}
          locale={locale}
          onUpdated={() => done(c.updated)}
        />
      ))}
      <NewIncident onCreated={() => done(c.recorded)} />
    </div>
  );
}

function IncidentItem({
  incident,
  locale,
  onUpdated,
}: {
  incident: Incident;
  locale: string;
  onUpdated: () => void;
}) {
  const { t } = useLocale();
  const c = t.compliance;
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  async function mark(field: 'authorityNotifiedAt' | 'membersNotifiedAt' | 'closedAt') {
    setBusy(true);
    setError(undefined);
    try {
      await api.updateIncident(incident.id, { [field]: new Date().toISOString() });
      onUpdated();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  const overdue = incident.notifyBy !== null && Date.parse(incident.notifyBy) < Date.now();
  return (
    <article className="evidence" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>
        <bdi>{incident.title}</bdi>{' '}
        <Badge tone={severityTone[incident.severity]}>{c.severities[incident.severity]}</Badge>{' '}
        {incident.closedAt ? <Badge tone="ok">{c.closed}</Badge> : null}
      </h3>
      {incident.notifyBy ? (
        <p className={overdue ? 'alert alert-error' : 'alert alert-info'} data-testid="notify-by">
          {overdue ? c.notifyOverdue : c.notifyBy} {formatDate(incident.notifyBy, locale)}
        </p>
      ) : null}
      <dl className="facts">
        <dt>{c.kind}</dt>
        <dd>{c.kinds[incident.kind]}</dd>
        {incident.occurredAt ? (
          <>
            <dt>{c.occurred}</dt>
            <dd>{formatDate(incident.occurredAt, locale)}</dd>
          </>
        ) : null}
        <dt>{c.discovered}</dt>
        <dd>{formatDate(incident.discoveredAt, locale)}</dd>
        <dt>{c.affected}</dt>
        <dd>{incident.affectedMembers ?? c.unknown}</dd>
        <dt>{c.description}</dt>
        <dd className="user-text" dir="auto">
          {incident.description}
        </dd>
        {incident.actions ? (
          <>
            <dt>{c.actions}</dt>
            <dd className="user-text" dir="auto">
              {incident.actions}
            </dd>
          </>
        ) : null}
        <dt>{c.authorityNotified}</dt>
        <dd>
          {incident.authorityNotifiedAt ? formatDate(incident.authorityNotifiedAt, locale) : '—'}
        </dd>
        <dt>{c.membersNotified}</dt>
        <dd>{incident.membersNotifiedAt ? formatDate(incident.membersNotifiedAt, locale) : '—'}</dd>
      </dl>
      {error ? <ErrorBox error={error} /> : null}
      {!incident.closedAt ? (
        <div className="actions">
          {!incident.authorityNotifiedAt ? (
            <button
              type="button"
              className="button small"
              disabled={busy}
              onClick={() => mark('authorityNotifiedAt')}
            >
              {c.markAuthority}
              <span className="visually-hidden">: {incident.title}</span>
            </button>
          ) : null}
          {!incident.membersNotifiedAt ? (
            <button
              type="button"
              className="button small"
              disabled={busy}
              onClick={() => mark('membersNotifiedAt')}
            >
              {c.markMembers}
              <span className="visually-hidden">: {incident.title}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => mark('closedAt')}
          >
            {c.markClosed}
            <span className="visually-hidden">: {incident.title}</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}

function NewIncident({ onCreated }: { onCreated: () => void }) {
  const { t } = useLocale();
  const c = t.compliance;
  const id = useId();
  const empty = {
    title: '',
    kind: 'unauthorized_access' as IncidentKind,
    severity: 'medium' as IncidentSeverity,
    occurredAt: '',
    discoveredAt: '',
    affected: '',
    description: '',
    actions: '',
  };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const set = (patch: Partial<typeof empty>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.createIncident({
        title: form.title.trim(),
        kind: form.kind,
        severity: form.severity,
        occurredAt: instant(form.occurredAt),
        discoveredAt: instant(form.discoveredAt) ?? new Date().toISOString(),
        affectedMembers: form.affected === '' ? null : Number(form.affected),
        description: form.description.trim(),
        actions: form.actions.trim() || null,
      });
      setForm(empty);
      onCreated();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{c.newIncident}</h3>
      <p className="alert alert-info" id={`${id}-privacy`}>
        {c.noPersonalData}
      </p>
      <label htmlFor={`${id}-t`}>{c.incidentTitle}</label>
      <input
        id={`${id}-t`}
        required
        maxLength={120}
        dir="auto"
        aria-describedby={`${id}-privacy`}
        value={form.title}
        onChange={(e) => set({ title: e.target.value })}
      />
      <div className="time-row">
        <div>
          <label htmlFor={`${id}-k`}>{c.kind}</label>
          <select
            id={`${id}-k`}
            value={form.kind}
            onChange={(e) => set({ kind: e.target.value as IncidentKind })}
          >
            {incidentKinds.map((k) => (
              <option key={k} value={k}>
                {c.kinds[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-s`}>{c.severity}</label>
          <select
            id={`${id}-s`}
            value={form.severity}
            aria-describedby={`${id}-s-help`}
            onChange={(e) => set({ severity: e.target.value as IncidentSeverity })}
          >
            {incidentSeverities.map((s) => (
              <option key={s} value={s}>
                {c.severities[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p id={`${id}-s-help`} className="help">
        {c.severityHelp}
      </p>
      <div className="time-row">
        <div>
          <label htmlFor={`${id}-o`}>{c.occurred}</label>
          <input
            id={`${id}-o`}
            type="datetime-local"
            value={form.occurredAt}
            onChange={(e) => set({ occurredAt: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`${id}-d`}>{c.discovered}</label>
          <input
            id={`${id}-d`}
            type="datetime-local"
            required
            value={form.discoveredAt}
            onChange={(e) => set({ discoveredAt: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`${id}-a`}>{c.affected}</label>
          <input
            id={`${id}-a`}
            type="number"
            min={0}
            inputMode="numeric"
            value={form.affected}
            onChange={(e) => set({ affected: e.target.value })}
          />
        </div>
      </div>
      <label htmlFor={`${id}-desc`}>{c.description}</label>
      <textarea
        id={`${id}-desc`}
        required
        maxLength={2000}
        rows={4}
        dir="auto"
        aria-describedby={`${id}-privacy`}
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
      />
      <label htmlFor={`${id}-act`}>{c.actions}</label>
      <textarea
        id={`${id}-act`}
        maxLength={2000}
        rows={3}
        dir="auto"
        value={form.actions}
        onChange={(e) => set({ actions: e.target.value })}
      />
      {error ? <ErrorBox error={error} /> : null}
      <button type="submit" className="button primary" disabled={busy}>
        {c.record}
      </button>
    </form>
  );
}

function Templates() {
  const { t } = useLocale();
  const c = t.compliance;
  const [error, setError] = useState<Error>();
  async function get(name: ComplianceTemplate, locale: 'en' | 'he') {
    setError(undefined);
    try {
      download(`${name}.${locale}.md`, await api.template(name, locale), 'text/markdown');
    } catch (err) {
      setError(err as Error);
    }
  }
  return (
    <div className="card">
      <h2>{c.templatesTitle}</h2>
      <p className="help">{c.templatesIntro}</p>
      {error ? <ErrorBox error={error} /> : null}
      <ul className="list">
        {complianceTemplates.map((name) => (
          <li key={name} className="list-item">
            <strong>{c.templates[name].title}</strong>
            <p className="help">{c.templates[name].help}</p>
            <div className="actions">
              <button type="button" className="button small" onClick={() => get(name, 'en')}>
                {c.downloadEn}
                <span className="visually-hidden">: {c.templates[name].title}</span>
              </button>
              <button type="button" className="button small" onClick={() => get(name, 'he')}>
                {c.downloadHe}
                <span className="visually-hidden">: {c.templates[name].title}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
