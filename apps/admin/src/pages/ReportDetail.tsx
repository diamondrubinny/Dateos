// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { moderationActions, type ModerationAction, type StaffMe } from '@nexaheart/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import {
  Badge,
  ErrorBox,
  formatDate,
  Loading,
  ProtectedAudio,
  ProtectedImage,
} from '../components/ui';

export function ReportDetail({ id, staff }: { id: string; staff: StaffMe }) {
  const { t, locale } = useLocale();
  const { data: report, error, loading, reload } = useAsync(() => api.report(id), [id]);
  const [action, setAction] = useState<ModerationAction>('dismiss');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [submitError, setSubmitError] = useState<Error>();
  const [liftReason, setLiftReason] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);
  const formId = useId();

  if (loading && !report) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!report) return null;

  const severe = action === 'suspend' || action === 'ban';
  const available = moderationActions.filter((a) => a !== 'ban' || staff.role === 'admin');
  const canSubmit = reason.trim().length >= 3 && (!severe || confirmed) && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(undefined);
    try {
      await api.resolve(id, action, reason.trim());
      setNotice(t.detail.done);
      reload();
      statusRef.current?.focus();
    } catch (err) {
      setSubmitError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function lift(event: FormEvent) {
    event.preventDefault();
    if (liftReason.trim().length < 3 || busy) return;
    setBusy(true);
    setSubmitError(undefined);
    try {
      await api.unsuspend(report!.reported.id, liftReason.trim());
      setNotice(t.detail.lifted);
      setLiftReason('');
      reload();
    } catch (err) {
      setSubmitError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const profile = report.reportedProfile;
  const name = report.reported.displayName ?? '—';

  return (
    <article aria-labelledby="report-title">
      <p>
        <a href="#/reports">{t.detail.back}</a>
      </p>
      <h1 id="report-title">
        {t.categories[report.category]}: <bdi>{name}</bdi>
      </h1>
      <p className="meta-row">
        <Badge tone={report.priority}>{t.priorities[report.priority]}</Badge>
        <span>{t.statuses[report.status]}</span>
        <span>{formatDate(report.createdAt, locale)}</span>
        <span>
          {t.detail.accountStatus}:{' '}
          {t.statuses[report.reported.status as 'active'] ?? report.reported.status}
        </span>
        <span>
          {t.reports.openAgainst}: {report.openReportsAgainst}
        </span>
      </p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={notice ? 'alert alert-ok' : 'visually-hidden'}
      >
        {notice ?? ''}
      </p>

      <div className="grid">
        <section className="card" aria-labelledby="details-title">
          <h2 id="details-title">{t.detail.details}</h2>
          <p className="user-text">
            {report.details ?? <span className="muted">{t.detail.noDetails}</span>}
          </p>
          <p className="muted">
            {t.detail.reporter}:{' '}
            {report.automatic ? (
              t.detail.automaticReporter
            ) : report.partnerCommunity !== null ? (
              <bdi>{format(t.detail.partnerReporter, { community: report.partnerCommunity })}</bdi>
            ) : (
              <bdi>{report.reporter.displayName ?? t.detail.deletedReporter}</bdi>
            )}
          </p>

          <h2>{t.detail.evidence}</h2>
          {report.evidence.length === 0 ? (
            <p className="muted">{t.detail.noEvidence}</p>
          ) : (
            <ol className="evidence">
              {report.evidence.map((m) => (
                <li
                  key={m.id}
                  className={m.from === 'reported' ? 'from-reported' : 'from-reporter'}
                >
                  <p className="evidence-meta">
                    <strong>
                      {m.from === 'reported' ? t.detail.fromReported : t.detail.fromReporter}
                    </strong>{' '}
                    <time dateTime={m.sentAt}>{formatDate(m.sentAt, locale)}</time>
                    {m.unsent ? (
                      <>
                        {' '}
                        <Badge tone="normal">{t.detail.unsent}</Badge>
                      </>
                    ) : null}
                    {m.flags.length > 0 ? (
                      <>
                        {' '}
                        <Badge tone="high">
                          {t.detail.flags}: {m.flags.join(', ')}
                        </Badge>
                      </>
                    ) : null}
                  </p>
                  {m.kind === 'voice' ? (
                    <ProtectedAudio
                      path={`/v1/admin/reports/${id}/evidence/${m.id}/audio`}
                      label={format(t.detail.voice, {
                        seconds: Math.round((m.durationMs ?? 0) / 1000),
                      })}
                    />
                  ) : (
                    <p className="user-text" dir="auto">
                      {m.body}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card" aria-labelledby="profile-title">
          <h2 id="profile-title">{t.detail.profile}</h2>
          {profile ? (
            <>
              <dl className="facts">
                <dt>{t.detail.age}</dt>
                <dd>{profile.age}</dd>
                <dt>{t.detail.verified}</dt>
                <dd>
                  {profile.verified ? (
                    <Badge tone="ok">✓ {t.detail.verified}</Badge>
                  ) : (
                    t.detail.notVerified
                  )}
                </dd>
                <dt>{t.detail.memberSince}</dt>
                <dd>{formatDate(profile.memberSince, locale)}</dd>
              </dl>
              {profile.bio ? (
                <p className="user-text" dir="auto">
                  {profile.bio}
                </p>
              ) : null}
              <ul className="prompts">
                {profile.prompts.map((p) => (
                  <li key={p.promptKey} dir="auto">
                    {p.answer}
                  </li>
                ))}
              </ul>
              <h3>{t.detail.photos}</h3>
              <div className="photo-grid">
                {profile.photoIds.map((photoId, i) => (
                  <ProtectedImage
                    key={photoId}
                    path={api.photoPath(report.reported.id, photoId)}
                    alt={format(t.detail.photoAlt, { n: i + 1 })}
                    className="photo"
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="muted">{t.detail.noProfile}</p>
          )}

          <h3>{t.detail.history}</h3>
          {report.history.length === 0 ? (
            <p className="muted">{t.detail.noHistory}</p>
          ) : (
            <ul className="history">
              {report.history.map((h, i) => (
                <li key={i}>
                  <strong>{t.actions[h.action]}</strong> · {formatDate(h.createdAt, locale)}
                  {h.staffName ? (
                    <>
                      {' '}
                      · <bdi>{h.staffName}</bdi>
                    </>
                  ) : null}
                  <br />
                  <span className="muted user-text">{h.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {report.status === 'open' ? (
        <section className="card" aria-labelledby={`${formId}-title`}>
          <h2 id={`${formId}-title`}>{t.detail.decision}</h2>
          <form onSubmit={submit}>
            <fieldset>
              <legend>{t.detail.action}</legend>
              {available.map((a) => (
                <div key={a} className="radio">
                  <input
                    type="radio"
                    id={`${formId}-${a}`}
                    name="action"
                    value={a}
                    checked={action === a}
                    aria-describedby={`${formId}-${a}-help`}
                    onChange={() => {
                      setAction(a);
                      setConfirmed(false);
                    }}
                  />
                  <label htmlFor={`${formId}-${a}`}>{t.actions[a]}</label>
                  <p id={`${formId}-${a}-help`} className="help">
                    {t.actionHelp[a]}
                  </p>
                </div>
              ))}
            </fieldset>
            <label htmlFor={`${formId}-reason`}>{t.detail.reason}</label>
            <textarea
              id={`${formId}-reason`}
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {severe ? (
              <div className="checkbox">
                <input
                  type="checkbox"
                  id={`${formId}-confirm`}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <label htmlFor={`${formId}-confirm`}>{t.detail.confirm}</label>
              </div>
            ) : null}
            {submitError ? <ErrorBox error={submitError} /> : null}
            <button
              type="submit"
              className={`button ${severe ? 'danger' : 'primary'}`}
              disabled={!canSubmit}
            >
              {t.detail.submit}: {t.actions[action]}
            </button>
          </form>
        </section>
      ) : (
        <section className="card" aria-labelledby="resolution-title">
          <h2 id="resolution-title">
            {report.resolution
              ? format(t.detail.resolved, { action: t.actions[report.resolution.action] })
              : t.statuses[report.status]}
          </h2>
          {report.resolution ? <p className="user-text muted">{report.resolution.reason}</p> : null}
          {staff.role === 'admin' && report.reported.status === 'suspended' ? (
            <form onSubmit={lift}>
              <label htmlFor="lift-reason">{t.detail.liftReason}</label>
              <textarea
                id="lift-reason"
                required
                minLength={3}
                maxLength={500}
                rows={2}
                value={liftReason}
                onChange={(e) => setLiftReason(e.target.value)}
              />
              {submitError ? <ErrorBox error={submitError} /> : null}
              <button
                type="submit"
                className="button"
                disabled={liftReason.trim().length < 3 || busy}
              >
                {t.detail.lift}
              </button>
            </form>
          ) : null}
        </section>
      )}
    </article>
  );
}
