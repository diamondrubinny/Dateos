// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  type Invite,
  type SignupMode,
  signupModes,
  type WaitlistEntry,
  type WaitlistStatus,
} from '@nexaheart/shared';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { Badge, ErrorBox, Loading } from '../components/ui';

/**
 * Who may open a new account (phase 21): the mode and personal invites (admins), invite codes
 * (admins), and the waitlist (all staff).
 */
export function Signup({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLocale();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState<string>();
  const announce = (text: string) => {
    setNotice(text);
    statusRef.current?.focus();
  };
  return (
    <section aria-labelledby="signup-title">
      <h1 id="signup-title">{t.signup.title}</h1>
      <p className="help">{t.signup.intro}</p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={notice ? 'alert alert-ok' : 'visually-hidden'}
      >
        {notice ?? ''}
      </p>
      {isAdmin ? <Mode onSaved={announce} /> : null}
      {isAdmin ? <Invites onChange={announce} /> : null}
      <Waitlist onChange={announce} />
    </section>
  );
}

function Mode({ onSaved }: { onSaved: (text: string) => void }) {
  const { t } = useLocale();
  const settings = useAsync(() => api.settings(), []);
  const [mode, setMode] = useState<SignupMode>();
  const [memberInvites, setMemberInvites] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error) return <ErrorBox error={settings.error} onRetry={settings.reload} />;
  const current = mode ?? settings.data!.signupMode;
  const members = memberInvites ?? settings.data!.memberInvites;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.saveSettings({ signupMode: current, memberInvites: members });
      onSaved(t.signup.saved);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" aria-labelledby="mode-title" onSubmit={save}>
      <h2 id="mode-title">{t.signup.modeTitle}</h2>
      <fieldset>
        <legend className="visually-hidden">{t.signup.modeTitle}</legend>
        {signupModes.map((m) => (
          <div className="radio" key={m}>
            <input
              id={`mode-${m}`}
              type="radio"
              name="signup-mode"
              value={m}
              checked={current === m}
              aria-describedby={`mode-${m}-help`}
              onChange={() => setMode(m)}
            />
            <label htmlFor={`mode-${m}`}>{t.signup.modes[m]}</label>
            <p className="help" id={`mode-${m}-help`}>
              {t.signup.modeHelp[m]}
            </p>
          </div>
        ))}
      </fieldset>
      <div className="checkbox">
        <input
          id="member-invites"
          type="checkbox"
          checked={members}
          disabled={current !== 'invite'}
          aria-describedby="member-invites-help"
          onChange={(e) => setMemberInvites(e.target.checked)}
        />
        <label htmlFor="member-invites">{t.signup.memberInvites}</label>
      </div>
      <p className="help" id="member-invites-help">
        {t.signup.memberInvitesHelp}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      <button type="submit" className="button primary" disabled={busy}>
        {t.signup.save}
      </button>
    </form>
  );
}

function inviteStatus(invite: Invite, t: ReturnType<typeof useLocale>['t']) {
  if (invite.revokedAt) return { tone: 'muted' as const, text: t.signup.revoked };
  if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
    return { tone: 'muted' as const, text: t.signup.expired };
  }
  if (invite.uses >= invite.maxUses) return { tone: 'muted' as const, text: t.signup.usedUp };
  return { tone: 'ok' as const, text: t.signup.active };
}

function Invites({ onChange }: { onChange: (text: string) => void }) {
  const { t, locale } = useLocale();
  const list = useAsync(() => api.invites(), []);
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [days, setDays] = useState('30');
  const [created, setCreated] = useState<Invite>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const uses = Number(maxUses);
  const expires = days.trim() === '' ? null : Number(days);
  const valid =
    Number.isInteger(uses) &&
    uses >= 1 &&
    uses <= 1000 &&
    (expires === null || (Number.isInteger(expires) && expires >= 1 && expires <= 365));
  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)) : '—';

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(undefined);
    try {
      const invite = await api.createInvite({
        ...(label.trim() ? { label: label.trim() } : {}),
        maxUses: uses,
        expiresInDays: expires,
      });
      setCreated(invite);
      setLabel('');
      list.reload();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invite: Invite) {
    setError(undefined);
    try {
      await api.revokeInvite(invite.id);
      onChange(t.signup.revokedNotice);
      list.reload();
    } catch (err) {
      setError(err as Error);
    }
  }

  const invites = list.data?.invites ?? [];
  return (
    <div className="grid venues-grid">
      <div className="card">
        <h2 id="invites-title">{t.signup.invitesTitle}</h2>
        {list.loading && !list.data ? <Loading /> : null}
        {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
        {list.data && invites.length === 0 ? <p className="empty">{t.signup.noInvites}</p> : null}
        {invites.length > 0 ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="invites-title">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.signup.label}</th>
                  <th scope="col">{t.signup.uses}</th>
                  <th scope="col">{t.signup.expires}</th>
                  <th scope="col">{t.signup.status}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.signup.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const status = inviteStatus(i, t);
                  return (
                    <tr key={i.id}>
                      <th scope="row">
                        {i.label ?? (i.byMember ? t.signup.byMember : t.signup.noLabel)}
                      </th>
                      <td dir="ltr">
                        {i.uses} / {i.maxUses}
                      </td>
                      <td>{date(i.expiresAt)}</td>
                      <td>
                        <Badge tone={status.tone}>{status.text}</Badge>
                      </td>
                      <td className="actions">
                        {status.tone === 'ok' ? (
                          <button
                            type="button"
                            className="button small"
                            onClick={() => void revoke(i)}
                          >
                            {t.signup.revoke}
                            <span className="visually-hidden"> {i.label ?? ''}</span>
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <form className="card" onSubmit={create} aria-labelledby="invite-form-title">
        <h2 id="invite-form-title">{t.signup.createTitle}</h2>
        <label htmlFor="invite-label">{t.signup.label}</label>
        <input
          id="invite-label"
          value={label}
          maxLength={60}
          aria-describedby="invite-label-help"
          onChange={(e) => setLabel(e.target.value)}
        />
        <p className="help" id="invite-label-help">
          {t.signup.labelHelp}
        </p>
        <label htmlFor="invite-uses">{t.signup.maxUses}</label>
        <input
          id="invite-uses"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          dir="ltr"
          required
          value={maxUses}
          aria-invalid={!Number.isInteger(uses) || uses < 1 || uses > 1000}
          onChange={(e) => setMaxUses(e.target.value)}
        />
        <label htmlFor="invite-days">{t.signup.expiresIn}</label>
        <input
          id="invite-days"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          dir="ltr"
          value={days}
          aria-describedby="invite-days-help"
          onChange={(e) => setDays(e.target.value)}
        />
        <p className="help" id="invite-days-help">
          {t.signup.expiresHelp}
        </p>
        {error ? <ErrorBox error={error} /> : null}
        {created?.code ? (
          <div className="alert alert-ok" role="status">
            <p>{t.signup.createdOnce}</p>
            <p className="code" dir="ltr" data-testid="invite-code">
              {created.code}
            </p>
          </div>
        ) : null}
        <button type="submit" className="button primary" disabled={busy || !valid}>
          {t.signup.create}
        </button>
      </form>
    </div>
  );
}

function Waitlist({ onChange }: { onChange: (text: string) => void }) {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<WaitlistStatus>('pending');
  const list = useAsync(() => api.waitlist(status), [status]);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState<string>();

  async function decide(entry: WaitlistEntry, approve: boolean) {
    setError(undefined);
    setBusy(entry.id);
    try {
      await api.decideWaitlist(entry.id, approve);
      onChange(format(approve ? t.signup.approved : t.signup.declined, { email: entry.email }));
      list.reload();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(undefined);
    }
  }

  const entries = list.data?.entries ?? [];
  return (
    <div className="card">
      <h2 id="waitlist-title">{t.signup.waitlistTitle}</h2>
      <p className="help">{t.signup.waitlistHelp}</p>
      <div className="segmented" role="group" aria-label={t.signup.waitlistTitle}>
        {(['pending', 'approved', 'declined'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className="button small"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {t.signup.waitlistStatus[s]}
          </button>
        ))}
      </div>
      {list.loading && !list.data ? <Loading /> : null}
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {list.data && entries.length === 0 ? <p className="empty">{t.signup.waitlistEmpty}</p> : null}
      {entries.length > 0 ? (
        <ul className="list">
          {entries.map((e) => (
            <li key={e.id} className="list-item">
              <p>
                <bdi dir="ltr">{e.email}</bdi>{' '}
                <span className="muted">
                  {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                    new Date(e.createdAt),
                  )}
                </span>
              </p>
              {e.note ? <p className="user-text">{e.note}</p> : null}
              {e.status === 'pending' ? (
                <div className="actions">
                  <button
                    type="button"
                    className="button small primary"
                    disabled={busy === e.id}
                    onClick={() => void decide(e, true)}
                  >
                    {t.signup.approve}
                    <span className="visually-hidden"> {e.email}</span>
                  </button>
                  <button
                    type="button"
                    className="button small"
                    disabled={busy === e.id}
                    onClick={() => void decide(e, false)}
                  >
                    {t.signup.decline}
                    <span className="visually-hidden"> {e.email}</span>
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
