// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  introductionWindows,
  matchmakersCsv,
  type IntroductionOrder,
  type MatchmakerRow,
} from '@nexaheart/shared';
import { useId, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { ErrorBox, formatDate, Loading } from '../components/ui';

/** Saves text as a file the browser downloads. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Phase 68a, Dashboard → Matchmakers (admins): who they are, who hears first, their credit. */
export function Matchmakers() {
  const { t } = useLocale();
  const m = t.matchmakers;
  const [tick, setTick] = useState(0);
  return (
    <section aria-labelledby="matchmakers-title">
      <h1 id="matchmakers-title">{m.title}</h1>
      <p>{m.intro}</p>
      <Grant onDone={() => setTick((n) => n + 1)} />
      <Order />
      <Report tick={tick} />
    </section>
  );
}

function Grant({ onDone }: { onDone: () => void }) {
  const { t } = useLocale();
  const m = t.matchmakers;
  const id = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setDone(false);
    try {
      await api.grantMatchmaker(email.trim());
      setEmail('');
      setDone(true);
      onDone();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{m.grantTitle}</h2>
      <p className="help">{m.grantHelp}</p>
      <label htmlFor={`${id}-email`}>{m.email}</label>
      <input
        id={`${id}-email`}
        type="email"
        required
        autoComplete="off"
        maxLength={254}
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error ? <ErrorBox error={error} /> : null}
      {done ? (
        <p className="alert alert-ok" role="status">
          {m.granted}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="button primary" disabled={busy}>
          {m.grant}
        </button>
      </div>
    </form>
  );
}

function Order() {
  const { t } = useLocale();
  const m = t.matchmakers;
  const settings = useAsync(() => api.settings(), []);
  const [choice, setChoice] = useState<IntroductionOrder>();
  const [hours, setHours] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);
  if (settings.loading && !settings.data) return <Loading />;
  if (!settings.data) return settings.error ? <ErrorBox error={settings.error} /> : null;
  const value = choice ?? settings.data.introductionOrder;
  const window = hours ?? settings.data.introductionHours;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveSettings({ introductionOrder: value, introductionHours: window });
      setSaved(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save} aria-labelledby="order-title">
      <h2 id="order-title">{m.orderTitle}</h2>
      <fieldset>
        <legend className="visually-hidden">{m.orderTitle}</legend>
        {(['together', 'women_first'] as const).map((o) => (
          <div key={o} className="checkbox">
            <input
              id={`order-${o}`}
              type="radio"
              name="introduction-order"
              checked={value === o}
              onChange={() => setChoice(o)}
            />
            <label htmlFor={`order-${o}`}>{m.orders[o]}</label>
          </div>
        ))}
      </fieldset>
      {/* Phase 75a: how long members have to answer. */}
      <label htmlFor="introduction-hours">{m.windowLabel}</label>
      <select
        id="introduction-hours"
        value={window}
        aria-describedby="introduction-hours-help"
        onChange={(e) => setHours(Number(e.target.value))}
      >
        {introductionWindows.map((h) => (
          <option key={h} value={h}>
            {h < 168 ? format(m.windowHours, { n: h }) : format(m.windowDays, { n: h / 24 })}
          </option>
        ))}
      </select>
      <p id="introduction-hours-help" className="help">
        {m.windowHelp}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      {saved ? (
        <p className="alert alert-ok" role="status">
          {m.saved}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="button primary" disabled={busy}>
          {m.save}
        </button>
      </div>
    </form>
  );
}

function Report({ tick }: { tick: number }) {
  const { t, locale } = useLocale();
  const m = t.matchmakers;
  const id = useId();
  const today = new Date();
  const [from, setFrom] = useState(day(new Date(today.getTime() - 365 * 86_400_000)));
  const [to, setTo] = useState(day(today));
  const [range, setRange] = useState({ from, to });
  const [revoking, setRevoking] = useState<MatchmakerRow>();
  const [error, setError] = useState<Error>();
  const report = useAsync(() => api.matchmakers(range.from, range.to), [range, tick]);

  async function revoke(row: MatchmakerRow) {
    setError(undefined);
    try {
      await api.revokeMatchmaker(row.userId);
      setRevoking(undefined);
      report.reload();
    } catch (err) {
      setError(err as Error);
    }
  }

  const rows = report.data?.matchmakers ?? [];
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        setRange({ from, to });
      }}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`}>{m.reportTitle}</h2>
      <p className="help">{m.reportIntro}</p>
      <div className="time-row">
        <div>
          <label htmlFor={`${id}-from`}>{m.from}</label>
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
          <label htmlFor={`${id}-to`}>{m.to}</label>
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
      <div className="actions">
        <button type="submit" className="button primary">
          {m.show}
        </button>
        {rows.length > 0 ? (
          <button
            type="button"
            className="button"
            onClick={() =>
              download(`matchmakers-${range.from}-${range.to}.csv`, matchmakersCsv(rows))
            }
          >
            {m.csv}
          </button>
        ) : null}
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {report.loading && !report.data ? <Loading /> : null}
      {report.error ? <ErrorBox error={report.error} /> : null}
      {report.data && rows.length === 0 ? <p>{m.none}</p> : null}
      {rows.length > 0 ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-labelledby={`${id}-title`}>
          <table>
            <thead>
              <tr>
                <th scope="col">{m.cols.name}</th>
                <th scope="col">{m.cols.since}</th>
                <th scope="col">{m.cols.introductions}</th>
                <th scope="col">{m.cols.matches}</th>
                <th scope="col">{m.cols.met}</th>
                <th scope="col">{m.cols.engaged}</th>
                <th scope="col">{m.cols.married}</th>
                <th scope="col">
                  <span className="visually-hidden">{m.cols.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <th scope="row" dir="auto">
                    {r.displayName}
                  </th>
                  <td>{formatDate(r.since, locale)}</td>
                  <td>{r.introductions}</td>
                  <td>{r.matches}</td>
                  <td>{r.met}</td>
                  <td>{r.engaged}</td>
                  <td>{r.married}</td>
                  <td>
                    {revoking?.userId === r.userId ? (
                      <span role="group" aria-label={m.revokeConfirm(r.displayName)}>
                        <span>{m.revokeConfirm(r.displayName)} </span>
                        <button
                          type="button"
                          className="button small danger"
                          onClick={() => void revoke(r)}
                        >
                          {m.revokeYes}
                        </button>{' '}
                        <button
                          type="button"
                          className="button small"
                          onClick={() => setRevoking(undefined)}
                        >
                          {m.cancel}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button small"
                        aria-label={m.revoke(r.displayName)}
                        onClick={() => setRevoking(r)}
                      >
                        {m.revokeShort}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </form>
  );
}
