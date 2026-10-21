import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useLocale } from '../i18n';

/** First run: the token holder becomes the first admin. */
export function ClaimInstance({ onClaimed }: { onClaimed: () => void }) {
  const { t } = useLocale();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await api.claim(token.trim());
      onClaimed();
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) setMessage(t.setup.taken);
      else if (err instanceof ApiError && err.status === 429) setMessage(t.rateLimited);
      else if (err instanceof ApiError && err.message.includes('disabled'))
        setMessage(t.setup.disabled);
      else setMessage(t.setup.invalid);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card narrow" aria-labelledby="claim-title">
      <h1 id="claim-title">{t.setup.title}</h1>
      <p>{t.setup.intro}</p>
      <form onSubmit={submit}>
        <label htmlFor="setup-token">{t.setup.token}</label>
        <input
          id="setup-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          dir="ltr"
          value={token}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? 'setup-error' : undefined}
          onChange={(e) => setToken(e.target.value)}
        />
        {message ? (
          <p id="setup-error" className="field-error" role="alert">
            {message}
          </p>
        ) : null}
        <button
          type="submit"
          className="button primary"
          disabled={busy || token.trim().length < 16}
        >
          {t.setup.submit}
        </button>
      </form>
    </section>
  );
}
