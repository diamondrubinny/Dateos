// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  UPDATE_PICKUP_MINUTES,
  UPDATE_SCHEDULE_MAX_DAYS,
  type UpdateStatusView,
} from '@nexaheart/shared';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAsync } from '../hooks';
import { useLocale } from '../i18n';
import { ErrorBox, Loading } from '../components/ui';

const short = (commit: string) => commit.slice(0, 7);

/** A `datetime-local` value (local time, minutes) for a Date. */
const localInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** The coming 03:00 in the admin's time zone: a quiet time for most communities. */
const nextQuietHour = (now = new Date()) => {
  const d = new Date(now);
  d.setHours(3, 0, 0, 0);
  if (d.getTime() <= now.getTime() + 15 * 60_000) d.setDate(d.getDate() + 1);
  return d;
};

/**
 * Updates from GitHub (phase 53), inside System: what's new and a button to approve installing it.
 * The approval is all the dashboard does; the server's updater installs it (scripts/update.sh).
 */
export function Updates() {
  const { t, locale } = useLocale();
  const u = t.updates;
  const { data, error, loading, reload } = useAsync(() => api.updates(), []);
  const [view, setView] = useState<UpdateStatusView>();
  const [busy, setBusy] = useState<'check' | 'install' | 'cancel'>();
  const [confirming, setConfirming] = useState(false);
  // Phase 56: install now, or at a time the admin chooses (their own time zone).
  const [later, setLater] = useState(false);
  const [at, setAt] = useState(() => localInput(nextQuietHour()));
  const [atError, setAtError] = useState(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [problem, setProblem] = useState<string>();
  const s = view ?? data;
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  // While an update waits or runs, follow it.
  const active = s?.request?.status === 'pending' || s?.request?.status === 'running';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      api.updates().then(setView, () => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const run = async (kind: 'check' | 'install' | 'cancel', fn: () => Promise<UpdateStatusView>) => {
    setBusy(kind);
    setProblem(undefined);
    try {
      setView(await fn());
      setConfirming(false);
    } catch (e) {
      setProblem(
        e instanceof ApiError && e.code === 'REAUTH_REQUIRED'
          ? u.reauth
          : e instanceof ApiError
            ? e.message
            : t.error,
      );
    } finally {
      setBusy(undefined);
    }
  };

  if (loading && !s) return <Loading />;
  if (error && !s) return <ErrorBox error={error} onRetry={reload} />;
  if (!s) return null;
  const r = s.request;
  // A scheduled one counts from its time, not from the approval (phase 56).
  const dueAt = r
    ? Math.max(Date.parse(r.requestedAt), r.notBefore ? Date.parse(r.notBefore) : 0)
    : 0;
  const scheduledLater = r?.status === 'pending' && dueAt > Date.now();
  const waitingLong =
    r?.status === 'pending' && Date.now() - dueAt > UPDATE_PICKUP_MINUTES * 60_000;
  const approve = () => {
    if (!later) return run('install', () => api.installUpdate(s.latest!));
    const chosen = new Date(at);
    const ok =
      !Number.isNaN(chosen.getTime()) &&
      chosen.getTime() > Date.now() &&
      chosen.getTime() <= Date.now() + UPDATE_SCHEDULE_MAX_DAYS * 86_400_000;
    setAtError(!ok);
    if (ok) void run('install', () => api.installUpdate(s.latest!, chosen.toISOString()));
  };
  const githubPr = (n: number) => `https://github.com/${s.repo}/pull/${n}`;

  return (
    <div className="updates-section" data-testid="updates">
      <h2 id="updates-title">{u.title}</h2>
      {problem ? (
        <p className="alert alert-error" role="alert">
          {problem}
        </p>
      ) : null}
      <p>
        {u.running}{' '}
        {s.current ? <code dir="ltr">{short(s.current)}</code> : <strong>{u.unknown}</strong>}
        {s.checkedAt ? <span className="muted"> · {u.checked(when(s.checkedAt))}</span> : null}
      </p>

      {!s.enabled ? <p>{u.off}</p> : null}
      {s.enabled && s.error === 'unknown-version' ? <p>{u.unknownHelp}</p> : null}
      {s.enabled && s.error && s.error !== 'unknown-version' ? (
        <p className="field-error">{u.failed(s.error)}</p>
      ) : null}

      {r && r.status !== 'cancelled' ? (
        <div
          className={`alert ${r.status === 'failed' ? 'alert-error' : 'alert-ok'}`}
          role={r.status === 'failed' ? 'alert' : 'status'}
          data-testid="update-request"
        >
          <p>
            <strong>
              {r.status === 'pending'
                ? scheduledLater
                  ? u.scheduled(when(r.notBefore!))
                  : u.pending
                : r.status === 'running'
                  ? u.installing
                  : r.status === 'done'
                    ? u.done(when(r.finishedAt ?? r.requestedAt))
                    : u.failedInstall}
            </strong>
          </p>
          {/* The server's message is English: its own direction, so punctuation stays put. */}
          {r.message ? <p dir="auto">{r.message}</p> : null}
          {waitingLong ? (
            <>
              <p>{u.noUpdater(UPDATE_PICKUP_MINUTES)}</p>
              <p>
                <code dir="ltr">cd /opt/nexaheart &amp;&amp; ./scripts/update.sh</code>
              </p>
            </>
          ) : null}
          {r.status === 'pending' ? (
            <button
              type="button"
              className="button small"
              disabled={busy !== undefined}
              onClick={() => run('cancel', () => api.cancelUpdate(r.id))}
            >
              {u.cancel}
            </button>
          ) : null}
        </div>
      ) : null}

      {s.behind > 0 && s.latest ? (
        <section aria-labelledby="updates-available" className="card">
          <h3 id="updates-available">{u.available(s.behind)}</h3>
          <ul data-testid="update-changes">
            {s.changes.map((c) => (
              <li key={`${c.number ?? ''}${c.title}`}>
                {/* Titles are usually English inside a Hebrew page: isolated, so dates stay whole. */}
                <bdi>{c.title}</bdi>
                {c.number !== null ? (
                  <>
                    {' '}
                    <a href={githubPr(c.number)} target="_blank" rel="noopener noreferrer">
                      #{c.number}
                    </a>
                  </>
                ) : null}
                {c.at ? (
                  <span className="muted">
                    {' · '}
                    <bdi>{when(c.at)}</bdi>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {s.current ? (
            <p>
              <a
                href={`https://github.com/${s.repo}/compare/${s.current}...${s.latest}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {u.allChanges}
              </a>
            </p>
          ) : null}
          {!active ? (
            confirming ? (
              <div className="alert" role="group" aria-labelledby="update-confirm-title">
                <p id="update-confirm-title">
                  <strong>{u.confirmTitle(short(s.latest))}</strong>
                </p>
                <ul>
                  {u.confirmSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
                <fieldset className="update-when">
                  <legend>{u.when}</legend>
                  <label className="radio">
                    <input
                      type="radio"
                      name="update-when"
                      checked={!later}
                      onChange={() => setLater(false)}
                    />
                    <span>{u.whenNow}</span>
                  </label>
                  <label className="radio">
                    <input
                      type="radio"
                      name="update-when"
                      checked={later}
                      onChange={() => setLater(true)}
                    />
                    <span>{u.whenLater}</span>
                  </label>
                  {later ? (
                    <div className="field">
                      <label htmlFor="update-at">{u.at}</label>
                      <input
                        id="update-at"
                        type="datetime-local"
                        value={at}
                        min={localInput(new Date())}
                        max={localInput(
                          new Date(Date.now() + UPDATE_SCHEDULE_MAX_DAYS * 86_400_000),
                        )}
                        aria-invalid={atError || undefined}
                        aria-describedby={
                          atError ? 'update-at-hint update-at-error' : 'update-at-hint'
                        }
                        onChange={(e) => {
                          setAt(e.target.value);
                          setAtError(false);
                        }}
                      />
                      <p id="update-at-hint" className="muted">
                        {u.atHint(zone, UPDATE_SCHEDULE_MAX_DAYS)}
                      </p>
                      {atError ? (
                        <p id="update-at-error" className="field-error" role="alert">
                          {u.atInvalid(UPDATE_SCHEDULE_MAX_DAYS)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </fieldset>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy !== undefined}
                  onClick={() => void approve()}
                >
                  {busy === 'install' ? u.approving : later ? u.approveAt : u.approve}
                </button>{' '}
                <button type="button" className="button" onClick={() => setConfirming(false)}>
                  {u.notNow}
                </button>
              </div>
            ) : (
              <button type="button" className="button primary" onClick={() => setConfirming(true)}>
                {u.install}
              </button>
            )
          ) : null}
        </section>
      ) : s.enabled && s.current && s.checkedAt && !s.error ? (
        <p className="alert alert-ok" role="status">
          {u.upToDate}
        </p>
      ) : null}

      {s.enabled ? <p className="muted">{s.emails ? u.emailsOn : u.emailsOff}</p> : null}

      {s.history.length > 0 ? (
        <div className="table-wrap">
          <table data-testid="update-history">
            <caption>{u.history.title}</caption>
            <thead>
              <tr>
                <th scope="col">{u.history.when}</th>
                <th scope="col">{u.history.version}</th>
                <th scope="col">{u.history.result}</th>
              </tr>
            </thead>
            <tbody>
              {s.history.map((h) => (
                <tr key={h.id}>
                  <td>
                    <bdi>{when(h.finishedAt ?? h.requestedAt)}</bdi>
                  </td>
                  <td>
                    <code dir="ltr">
                      {h.from ? `${short(h.from)} → ` : ''}
                      {short(h.target)}
                    </code>
                  </td>
                  <td>
                    <strong>{u.history[h.status as 'done' | 'failed' | 'cancelled']}</strong>
                    {h.message ? (
                      <span className="muted">
                        {' · '}
                        <bdi>{h.message}</bdi>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {s.enabled ? (
        <button
          type="button"
          className="button"
          disabled={busy !== undefined}
          onClick={() => run('check', () => api.checkUpdates())}
        >
          {busy === 'check' ? u.checking : u.checkNow}
        </button>
      ) : null}
    </div>
  );
}

/** On every page, for admins: an update is ready, or one is running or failed (phase 53). */
export function UpdateBanner() {
  const { t } = useLocale();
  const { data } = useAsync(() => api.updates().catch(() => null), []);
  if (!data) return null;
  const r = data.request;
  const text =
    r?.status === 'running' || r?.status === 'pending'
      ? t.updates.bannerRunning
      : r?.status === 'failed' && data.behind > 0
        ? t.updates.bannerFailed
        : data.behind > 0
          ? t.updates.banner(data.behind)
          : null;
  if (!text) return null;
  return (
    <p className="update-banner" role="status" data-testid="update-banner">
      {text} <a href="#/system">{t.updates.bannerLink}</a>
    </p>
  );
}
