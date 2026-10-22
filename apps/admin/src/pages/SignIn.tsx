// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useLocale } from '../i18n';
import { ErrorBox } from '../components/ui';

export function SignIn() {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.requestLink(email.trim(), `${window.location.origin}${window.location.pathname}`);
      setSent(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card narrow" aria-labelledby="signin-title">
      <h1 id="signin-title">{t.signIn.title}</h1>
      <p>{t.signIn.intro}</p>
      {sent ? (
        <p className="alert alert-ok" role="status">
          {t.signIn.sent}
        </p>
      ) : (
        <form onSubmit={submit} noValidate={false}>
          <label htmlFor="email">{t.signIn.email}</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error ? <ErrorBox error={error} /> : null}
          <button type="submit" className="button primary" disabled={busy} aria-disabled={busy}>
            {t.signIn.submit}
          </button>
        </form>
      )}
    </section>
  );
}
