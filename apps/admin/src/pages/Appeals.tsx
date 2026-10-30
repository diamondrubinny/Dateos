// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  MAX_APPEAL_RESPONSE,
  MIN_DECISION_EXPLANATION,
  type AppealSummary,
} from '@nexaheart/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { useLocale } from '../i18n';
import { Badge, ErrorBox, formatDate, Loading } from '../components/ui';

/** Phase 61: members' appeals against decisions, decided by a person (DSA Art. 20 ⚖️). */
export function Appeals() {
  const { t } = useLocale();
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const { data, error, loading, reload } = useAsync(() => api.appeals(status), [status]);
  const [notice, setNotice] = useState<string>();
  const statusRef = useRef<HTMLParagraphElement>(null);

  return (
    <section aria-labelledby="appeals-title">
      <h1 id="appeals-title">{t.appeals.title}</h1>
      <p>{t.appeals.intro}</p>
      <div className="segmented" role="group" aria-label={t.reports.status}>
        {(['open', 'closed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {t.appeals[s]}
          </button>
        ))}
      </div>
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
      {data && data.appeals.length === 0 ? (
        <p className="empty">{status === 'open' ? t.appeals.empty : t.appeals.emptyClosed}</p>
      ) : null}
      {data?.appeals.map((a) => (
        <AppealCard
          key={a.id}
          appeal={a}
          onDecided={() => {
            setNotice(t.appeals.done);
            reload();
            statusRef.current?.focus();
          }}
        />
      ))}
    </section>
  );
}

function AppealCard({ appeal, onDecided }: { appeal: AppealSummary; onDecided: () => void }) {
  const { t, locale } = useLocale();
  const formId = useId();
  const [reverse, setReverse] = useState<boolean>();
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<Error>();
  const { decision } = appeal;
  const name = appeal.member.displayName ?? '—';
  const canSubmit =
    reverse !== undefined && response.trim().length >= MIN_DECISION_EXPLANATION && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(undefined);
    try {
      await api.decideAppeal(appeal.id, reverse!, response.trim());
      onDecided();
    } catch (err) {
      setSubmitError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`}>
        <bdi>{name}</bdi> · {t.actions[decision.action]}{' '}
        <span className="muted small">{formatDate(appeal.createdAt, locale)}</span>{' '}
        {appeal.status !== 'open' ? (
          <Badge tone={appeal.status === 'reversed' ? 'ok' : 'muted'}>
            {t.appeals.status[appeal.status]}
          </Badge>
        ) : null}
      </h2>

      <h3>{t.appeals.decision}</h3>
      <dl className="facts">
        <dt>{t.detail.action}</dt>
        <dd>
          {t.actions[decision.action]}
          {decision.category ? <> · {t.categories[decision.category]}</> : null} ·{' '}
          {formatDate(decision.createdAt, locale)}
        </dd>
        <dt>{t.detail.ground}</dt>
        <dd>{decision.ground === 'terms' ? t.detail.groundTerms : t.detail.groundIllegal}</dd>
        <dt>{t.detail.told}</dt>
        <dd className="user-text" dir="auto">
          {decision.explanation ?? '—'}
        </dd>
        <dt>{t.appeals.note}</dt>
        <dd className="user-text muted" dir="auto">
          {decision.reason}
        </dd>
        {decision.staffName ? (
          <>
            <dt>{t.appeals.decidedBy}</dt>
            <dd>
              <bdi>{decision.staffName}</bdi>
            </dd>
          </>
        ) : null}
        {decision.automatedDetection ? (
          <>
            <dt>{t.appeals.automated}</dt>
            <dd>✓</dd>
          </>
        ) : null}
      </dl>
      {decision.reportId ? (
        <p>
          <a href={`#/reports/${decision.reportId}`}>{t.appeals.report}</a>
        </p>
      ) : null}

      <h3>{t.appeals.appeal}</h3>
      <blockquote className="user-text" dir="auto">
        {appeal.text}
      </blockquote>

      {appeal.status !== 'open' ? (
        <p className="user-text" dir="auto">
          <strong>{t.appeals.response}:</strong> {appeal.response}
        </p>
      ) : appeal.canDecide ? (
        <form onSubmit={submit}>
          <fieldset>
            <legend>{t.detail.decision}</legend>
            {([false, true] as const).map((r) => (
              <div key={String(r)} className="radio">
                <input
                  type="radio"
                  id={`${formId}-${r ? 'reverse' : 'uphold'}`}
                  name={`${formId}-outcome`}
                  checked={reverse === r}
                  aria-describedby={r ? `${formId}-reverse-help` : undefined}
                  onChange={() => setReverse(r)}
                />
                <label htmlFor={`${formId}-${r ? 'reverse' : 'uphold'}`}>
                  {r ? t.appeals.reverse : t.appeals.uphold}
                </label>
                {r ? (
                  <p id={`${formId}-reverse-help`} className="help">
                    {t.appeals.reverseHelp[decision.action]}
                  </p>
                ) : null}
              </div>
            ))}
          </fieldset>
          <label htmlFor={`${formId}-response`}>{t.appeals.response}</label>
          <textarea
            id={`${formId}-response`}
            required
            minLength={MIN_DECISION_EXPLANATION}
            maxLength={MAX_APPEAL_RESPONSE}
            rows={4}
            dir="auto"
            aria-describedby={`${formId}-response-help`}
            value={response}
            onChange={(e) => setResponse(e.target.value)}
          />
          <p id={`${formId}-response-help`} className="help">
            {t.appeals.responseHelp}
          </p>
          {submitError ? <ErrorBox error={submitError} /> : null}
          <button type="submit" className="button primary" disabled={!canSubmit}>
            {t.detail.submit}
            <span className="visually-hidden">: {name}</span>
          </button>
        </form>
      ) : (
        <p className="alert alert-info">{t.appeals.cannotDecide}</p>
      )}
    </article>
  );
}
