// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Partner, PartnersResponse } from '@nexaheart/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type AdminInstanceSettings } from '../api';
import { format, useLocale } from '../i18n';
import { Badge, ErrorBox, formatDate, Loading } from '../components/ui';

const tones = {
  active: 'ok',
  invited_in: 'high',
  invited_out: 'normal',
  suspended: 'urgent',
  ended: 'muted',
} as const;

/**
 * Phase 73a: what partners see before a match (the full or the short card), and this community's
 * country, told to partners. Admins only.
 */
function BeforeAMatch() {
  const { t } = useLocale();
  const p = t.partners;
  const [settings, setSettings] = useState<AdminInstanceSettings>();
  const [cards, setCards] = useState<'full' | 'minimal'>('full');
  const [country, setCountry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings().then(
      (s) => {
        setSettings(s);
        setCards(s.partnerCards);
        setCountry(s.communityCountry ?? '');
      },
      (err: Error) => setError(err),
    );
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      setSettings(
        await api.saveSettings({
          partnerCards: cards,
          communityCountry: country.trim().toUpperCase() || null,
        }),
      );
      setSaved(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return error ? <ErrorBox error={error} /> : null;
  return (
    <form className="card stack" aria-labelledby="before-match-title" onSubmit={save}>
      <h2 id="before-match-title">{p.privacyTitle}</h2>
      <fieldset>
        <legend>{p.cardsLabel}</legend>
        {(['full', 'minimal'] as const).map((mode) => (
          <label key={mode} className="checkbox">
            <input
              type="radio"
              name="partner-cards"
              value={mode}
              checked={cards === mode}
              onChange={() => setCards(mode)}
            />
            {mode === 'full' ? p.cardsFull : p.cardsMinimal}
          </label>
        ))}
        <p className="help">{p.cardsHelp}</p>
      </fieldset>
      <label htmlFor="community-country">{p.countryLabel}</label>
      <input
        id="community-country"
        dir="ltr"
        maxLength={2}
        autoComplete="off"
        aria-describedby="community-country-help"
        value={country}
        onChange={(e) => setCountry(e.target.value)}
        pattern="[A-Za-z]{2}"
        style={{ maxWidth: '6em' }}
      />
      <p id="community-country-help" className="help">
        {p.countryHelp}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      <p role="status" className={saved ? 'alert alert-ok' : 'visually-hidden'}>
        {saved ? p.savedPrivacy : ''}
      </p>
      <button type="submit" className="button primary" disabled={busy}>
        {p.savePrivacy}
      </button>
    </form>
  );
}

/**
 * Communities that connect (phase 28): partnerships with other NexaHeart communities, and (28d)
 * suspending one and the reports between them. Moderators can read, admins decide.
 */
export function Partners({ isAdmin }: { isAdmin: boolean }) {
  const { t, locale } = useLocale();
  const p = t.partners;
  const [data, setData] = useState<PartnersResponse>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [url, setUrl] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [acceptAgreed, setAcceptAgreed] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    api.partners().then(setData, (err: Error) => setError(err));
  }, []);

  const run = async (action: () => Promise<PartnersResponse>, done: string) => {
    setBusy(true);
    setError(undefined);
    try {
      setData(await action());
      setStatus(done);
      statusRef.current?.focus();
      return true;
    } catch (err) {
      setError(err as Error);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.invitePartner(url.trim()), p.invited).then((ok) => {
      if (ok) {
        setUrl('');
        setAgreed(false);
      }
    });
  };

  const row = (x: Partner) => (
    <li key={x.id} className="partner">
      <h3 dir="auto">
        {x.name} <Badge tone={tones[x.status]}>{p.status[x.status]}</Badge>
      </h3>
      <p className="muted" dir="ltr">
        {x.url}
      </p>
      <p className="muted">
        {x.contact ? (
          <>
            {p.contact}: <span dir="ltr">{x.contact}</span>
          </>
        ) : null}
        {x.privacyUrl ? (
          <>
            {x.contact ? ' · ' : null}
            <a href={x.privacyUrl} target="_blank" rel="noreferrer noopener">
              {p.privacy}
            </a>
          </>
        ) : null}
      </p>
      <p className="muted">
        {x.activatedAt
          ? format(p.since, { when: formatDate(x.activatedAt, locale) })
          : format(p.created, { when: formatDate(x.createdAt, locale) })}
        {x.lastSeenAt ? ` · ${format(p.lastSeen, { when: formatDate(x.lastSeenAt, locale) })}` : ''}
      </p>
      {x.status === 'active' || x.status === 'suspended' ? (
        <p className="muted">
          {format(p.counts, {
            sent: x.reports.sent,
            reviewed: x.reports.reviewed,
            received: x.reports.received,
          })}
          {x.outbox > 0 ? ` · ${format(p.outbox, { n: x.outbox })}` : ''}
        </p>
      ) : null}
      {x.country ? <p className="muted">{format(p.country, { country: x.country })}</p> : null}
      {x.atRisk && x.status !== 'ended' ? (
        <p className="alert alert-error" data-testid="partner-at-risk">
          {p.atRisk}
        </p>
      ) : null}
      {x.status === 'suspended' ? <p className="muted">{p.suspendedNote}</p> : null}
      {x.lastError ? (
        <p className="alert alert-error" dir="auto">
          {x.lastError}
        </p>
      ) : null}
      {isAdmin && x.status !== 'ended' ? (
        <div className="row-actions">
          {x.status === 'invited_in' && accepting !== x.id ? (
            <button
              type="button"
              className="button small primary"
              onClick={() => {
                setAccepting(x.id);
                setAcceptAgreed(false);
              }}
            >
              {p.accept}
              <span className="visually-hidden"> {x.name}</span>
            </button>
          ) : null}
          {x.status === 'active' ? (
            <button
              type="button"
              className="button small"
              disabled={busy}
              onClick={() => void run(() => api.testPartner(x.id), p.tested)}
            >
              {p.test}
              <span className="visually-hidden"> {x.name}</span>
            </button>
          ) : null}
          {x.status === 'active' ? (
            <button
              type="button"
              className="button small"
              disabled={busy}
              onClick={() => void run(() => api.suspendPartner(x.id), p.suspendedDone)}
            >
              {p.suspend}
              <span className="visually-hidden"> {x.name}</span>
            </button>
          ) : null}
          {x.status === 'suspended' ? (
            <button
              type="button"
              className="button small primary"
              disabled={busy}
              onClick={() => void run(() => api.resumePartner(x.id), p.resumedDone)}
            >
              {p.resume}
              <span className="visually-hidden"> {x.name}</span>
            </button>
          ) : null}
          {ending === x.id ? (
            <>
              <span role="alert">{format(p.endConfirm, { name: x.name })}</span>
              <button
                type="button"
                className="button small danger"
                disabled={busy}
                onClick={() =>
                  void run(() => api.endPartner(x.id), p.ended).then(() => setEnding(null))
                }
              >
                {p.endYes}
              </button>
              <button type="button" className="button small" onClick={() => setEnding(null)}>
                {p.endNo}
              </button>
            </>
          ) : (
            <button type="button" className="button small" onClick={() => setEnding(x.id)}>
              {x.status === 'invited_in' ? p.decline : p.end}
              <span className="visually-hidden"> {x.name}</span>
            </button>
          )}
        </div>
      ) : null}
      {accepting === x.id ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.acceptPartner(x.id), p.accepted).then(
              (ok) => ok && setAccepting(null),
            );
          }}
        >
          <label className="checkbox">
            <input
              type="checkbox"
              checked={acceptAgreed}
              onChange={(e) => setAcceptAgreed(e.target.checked)}
              required
            />
            {format(p.agreement, { name: x.name })}
          </label>
          <button type="submit" className="button primary" disabled={busy || !acceptAgreed}>
            {p.acceptConfirm}
          </button>
        </form>
      ) : null}
    </li>
  );

  return (
    <section aria-labelledby="partners-title">
      <h1 id="partners-title">{p.title}</h1>
      <p className="help">{p.intro}</p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={status ? 'alert alert-ok' : 'visually-hidden'}
      >
        {status}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      {!data && !error ? <Loading /> : null}
      {data && !data.enabled ? (
        <div className="card">
          <h2>{p.offTitle}</h2>
          <p>{data.reason === 'no_key' ? p.noKey : p.off}</p>
        </div>
      ) : null}
      {data?.enabled && data.self ? (
        <div className="card">
          <h2>{p.selfTitle}</h2>
          <p>
            {p.selfAddress} <code dir="ltr">{data.self.url}</code>
          </p>
          <p className="muted">
            {data.key?.rotatedAt
              ? format(p.keyRotated, { when: formatDate(data.key.rotatedAt, locale) })
              : p.keyNever}
            {data.key && data.key.waiting > 0
              ? ` · ${format(p.keyWaiting, { n: data.key.waiting })}`
              : ''}
          </p>
          {isAdmin ? (
            rotating ? (
              <div className="row-actions">
                <span role="alert">{p.rotateConfirm}</span>
                <button
                  type="button"
                  className="button small danger"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.rotateFederationKey(), p.rotated).then(() =>
                      setRotating(false),
                    )
                  }
                >
                  {p.rotateYes}
                </button>
                <button type="button" className="button small" onClick={() => setRotating(false)}>
                  {p.endNo}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="button small"
                disabled={busy || (data.key?.waiting ?? 0) > 0}
                onClick={() => setRotating(true)}
              >
                {p.rotate}
              </button>
            )
          ) : null}
          <p className="muted">{p.agreementTemplate}</p>
          {isAdmin ? (
            <form className="stack" onSubmit={invite}>
              <label htmlFor="partner-url">{p.inviteLabel}</label>
              <input
                id="partner-url"
                type="url"
                dir="ltr"
                inputMode="url"
                placeholder="https://api.example.org"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  required
                />
                {p.agreementInvite}
              </label>
              <button type="submit" className="button primary" disabled={busy || !agreed}>
                {p.invite}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {data?.enabled && isAdmin ? <BeforeAMatch /> : null}
      {data && data.partners.length === 0 && data.enabled ? (
        <p className="empty">{p.empty}</p>
      ) : null}
      {data && data.partners.length > 0 ? (
        <ul className="board-list">{data.partners.map(row)}</ul>
      ) : null}
    </section>
  );
}
