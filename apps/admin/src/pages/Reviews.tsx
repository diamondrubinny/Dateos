// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  MAX_REVIEW_NOTE,
  profileReviewReasons,
  type PendingProfile,
  type ProfileReviewReason,
} from '@nexaheart/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { ErrorBox, formatDate, Loading, ProtectedImage } from '../components/ui';

/**
 * Phase 68c, Dashboard → New profiles: where the community asks for it, a moderator approves each
 * new profile before others see it, or asks for a change (the member sees the reason and note).
 */
export function Reviews({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLocale();
  const r = t.reviews;
  const queue = useAsync(() => api.profileReviews(), []);
  return (
    <section aria-labelledby="reviews-title">
      <h1 id="reviews-title">{r.title}</h1>
      <p>{r.intro}</p>
      {isAdmin ? <ApprovalSetting /> : null}
      {queue.loading && !queue.data ? <Loading /> : null}
      {queue.error ? <ErrorBox error={queue.error} onRetry={queue.reload} /> : null}
      {queue.data && queue.data.profiles.length === 0 ? <p>{r.empty}</p> : null}
      {queue.data?.profiles.map((p) => (
        <Pending key={p.userId} profile={p} onDone={queue.reload} />
      ))}
    </section>
  );
}

function ApprovalSetting() {
  const { t } = useLocale();
  const r = t.reviews;
  const settings = useAsync(() => api.settings(), []);
  const [on, setOn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);
  if (!settings.data) return settings.error ? <ErrorBox error={settings.error} /> : null;
  const value = on ?? settings.data.profileApproval;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveSettings({ profileApproval: value });
      setSaved(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save} aria-labelledby="approval-title">
      <h2 id="approval-title">{r.settingTitle}</h2>
      <div className="checkbox">
        <input
          id="profile-approval"
          type="checkbox"
          checked={value}
          aria-describedby="profile-approval-help"
          onChange={(e) => setOn(e.target.checked)}
        />
        <label htmlFor="profile-approval">{r.settingLabel}</label>
      </div>
      <p id="profile-approval-help" className="help">
        {r.settingHelp}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      <p role="status" className={saved ? 'alert alert-ok' : 'visually-hidden'}>
        {saved ? r.saved : ''}
      </p>
      <div className="actions">
        <button type="submit" className="button primary" disabled={busy}>
          {r.save}
        </button>
      </div>
    </form>
  );
}

function Pending({ profile, onDone }: { profile: PendingProfile; onDone: () => void }) {
  const { t, locale } = useLocale();
  const r = t.reviews;
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<ProfileReviewReason>('photos');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const id = `review-${profile.userId}`;

  async function decide(approve: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await api.decideReview(
        profile.userId,
        approve
          ? { decision: 'approve' }
          : { decision: 'changes', reason, note: note.trim() || null },
      );
      onDone();
    } catch (err) {
      setError(err as Error);
      setBusy(false);
    }
  }

  return (
    <article className="card" aria-labelledby={`${id}-name`} data-testid="pending-profile">
      <h2 id={`${id}-name`} dir="auto">
        {profile.displayName}, {profile.age}
      </h2>
      <p className="help">
        {profile.resubmitted ? r.resubmitted : r.newProfile} · {formatDate(profile.since, locale)}
      </p>
      <div className="photo-grid">
        {profile.photoIds.map((photoId, i) => (
          <ProtectedImage
            key={photoId}
            path={api.photoPath(profile.userId, photoId)}
            alt={format(t.detail.photoAlt, { n: i + 1 })}
            className="photo"
          />
        ))}
      </div>
      {profile.bio ? <p dir="auto">{profile.bio}</p> : null}
      {profile.prompts.length > 0 ? (
        <dl>
          {profile.prompts.map((p) => (
            <div key={p.promptKey}>
              <dt>{r.answer}</dt>
              <dd dir="auto">{p.answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {error ? <ErrorBox error={error} /> : null}
      {asking ? (
        <fieldset>
          <legend>{r.askTitle}</legend>
          {profileReviewReasons.map((x) => (
            <div key={x} className="checkbox">
              <input
                id={`${id}-${x}`}
                type="radio"
                name={`${id}-reason`}
                checked={reason === x}
                onChange={() => setReason(x)}
              />
              <label htmlFor={`${id}-${x}`}>{r.reasons[x]}</label>
            </div>
          ))}
          <label htmlFor={`${id}-note`}>{r.note}</label>
          <textarea
            id={`${id}-note`}
            rows={3}
            dir="auto"
            maxLength={MAX_REVIEW_NOTE}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              {format(r.send, { name: profile.displayName })}
            </button>
            <button type="button" className="button" onClick={() => setAsking(false)}>
              {r.cancel}
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void decide(true)}
          >
            {format(r.approve, { name: profile.displayName })}
          </button>
          <button type="button" className="button" onClick={() => setAsking(true)}>
            {format(r.ask, { name: profile.displayName })}
          </button>
        </div>
      )}
    </article>
  );
}
