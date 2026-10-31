// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { type EventProposal } from '@nexaheart/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { ErrorBox, formatDate } from '../components/ui';

/**
 * Community organizers (phase 71e), admins only: who may propose events, and their proposals
 * waiting for an answer. Approving publishes the event with the organizer on it.
 */
export function EventOrganizers({ onPublished }: { onPublished: () => void }) {
  const { t, locale } = useLocale();
  const a = t.organizers;
  const organizers = useAsync(() => api.organizers(), []);
  const proposals = useAsync(() => api.proposals(), []);
  const [email, setEmail] = useState('');
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<Error>();
  const [status, setStatus] = useState('');

  const act = async (work: () => Promise<unknown>, done: string) => {
    setError(undefined);
    try {
      await work();
      setStatus(done);
      organizers.reload();
      proposals.reload();
    } catch (err) {
      setError(err as Error);
    }
  };
  const grant = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await api.grantOrganizer(email.trim());
      setEmail('');
    }, a.granted);
  };
  const approve = (p: EventProposal) =>
    void act(
      async () => {
        await api.approveProposal(p.id);
        onPublished();
      },
      format(a.approved, { title: p.title }),
    );
  const decline = (p: EventProposal) =>
    void act(
      async () => {
        await api.declineProposal(p.id, reason.trim());
        setDeclining(null);
        setReason('');
      },
      format(a.declinedDone, { title: p.title }),
    );

  const waiting = proposals.data?.proposals ?? [];
  return (
    <section className="card" aria-labelledby="organizers-title">
      <h2 id="organizers-title">{a.title}</h2>
      <p className="help">{a.intro}</p>
      <p role="status" className={status ? 'alert alert-ok' : 'visually-hidden'}>
        {status}
      </p>
      {error ? <ErrorBox error={error} /> : null}

      <h3>{a.proposalsTitle}</h3>
      {waiting.length === 0 ? <p className="empty">{a.noProposals}</p> : null}
      <ul className="board-list">
        {waiting.map((p) => (
          <li key={p.id} data-testid="proposal">
            <p>
              <strong dir="auto">{p.title}</strong>{' '}
              <span className="muted">
                {format(a.proposedBy, { name: p.organizer?.displayName ?? '' })}
              </span>
            </p>
            <p className="muted">
              {formatDate(p.startsAt, locale)}
              {p.venue ? ` · ${p.venue.name}, ${p.venue.area}` : ''}
              {p.capacity !== null ? ` · ${format(a.places, { n: p.capacity })}` : ''}
            </p>
            {p.description ? <p dir="auto">{p.description}</p> : null}
            {declining === p.id ? (
              <div className="stack">
                <label htmlFor={`decline-${p.id}`}>{a.reason}</label>
                <textarea
                  id={`decline-${p.id}`}
                  rows={2}
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="actions">
                  <button
                    type="button"
                    className="button small danger"
                    disabled={reason.trim().length < 3}
                    onClick={() => decline(p)}
                  >
                    {a.declineYes}
                  </button>
                  <button type="button" className="button small" onClick={() => setDeclining(null)}>
                    {t.events.confirmNo}
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button type="button" className="button small primary" onClick={() => approve(p)}>
                  {a.approve}
                  <span className="visually-hidden"> {p.title}</span>
                </button>
                <button type="button" className="button small" onClick={() => setDeclining(p.id)}>
                  {a.decline}
                  <span className="visually-hidden"> {p.title}</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <h3>{a.listTitle}</h3>
      {(organizers.data?.organizers ?? []).length === 0 ? (
        <p className="empty">{a.none}</p>
      ) : (
        <ul className="board-list">
          {organizers.data!.organizers.map((o) => (
            <li key={o.userId}>
              <p>
                <strong dir="auto">{o.displayName}</strong>{' '}
                <span className="muted">
                  {format(a.since, { date: formatDate(o.since, locale), n: o.events })}
                </span>
              </p>
              <button
                type="button"
                className="button small"
                onClick={() => void act(() => api.revokeOrganizer(o.userId), a.revoked)}
              >
                {a.revoke}
                <span className="visually-hidden"> {o.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={grant}>
        <label htmlFor="organizer-email">{a.email}</label>
        <input
          id="organizer-email"
          type="email"
          required
          dir="ltr"
          value={email}
          aria-describedby="organizer-email-help"
          onChange={(e) => setEmail(e.target.value)}
        />
        <p id="organizer-email-help" className="help">
          {a.emailHelp}
        </p>
        <button type="submit" className="button">
          {a.grant}
        </button>
      </form>
    </section>
  );
}
