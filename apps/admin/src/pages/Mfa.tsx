import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useLocale } from '../i18n';
import { ErrorBox } from '../components/ui';

function CodeForm({ onVerified }: { onVerified: () => void }) {
  const { t } = useLocale();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await api.mfaVerify(code);
      onVerified();
    } catch (err) {
      setMessage(err instanceof ApiError && err.status === 403 ? t.mfa.locked : t.mfa.invalid);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="code">{t.mfa.code}</label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        dir="ltr"
        className="code-input"
        value={code}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? 'code-error' : undefined}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      {message ? (
        <p id="code-error" className="field-error" role="alert">
          {message}
        </p>
      ) : null}
      <button type="submit" className="button primary" disabled={busy || code.length !== 6}>
        {t.mfa.submit}
      </button>
    </form>
  );
}

export function MfaSetup({ onVerified }: { onVerified: () => void }) {
  const { t } = useLocale();
  const [setup, setSetup] = useState<{ secret: string; qr: string }>();
  const [error, setError] = useState<Error>();

  async function start() {
    setError(undefined);
    try {
      const result = await api.mfaSetup();
      const qr = await QRCode.toDataURL(result.otpauthUrl, { margin: 1, width: 220 });
      setSetup({ secret: result.secret, qr });
    } catch (err) {
      setError(err as Error);
    }
  }

  return (
    <section className="card narrow" aria-labelledby="mfa-setup-title">
      <h1 id="mfa-setup-title">{t.mfa.setupTitle}</h1>
      <p>{t.mfa.setupIntro}</p>
      {error ? <ErrorBox error={error} /> : null}
      {setup ? (
        <>
          <img className="qr" src={setup.qr} alt={t.mfa.qrAlt} width={220} height={220} />
          <p>{t.mfa.manual}</p>
          <p>
            <code className="secret" dir="ltr">
              {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
            </code>
          </p>
          <CodeForm onVerified={onVerified} />
        </>
      ) : (
        <button type="button" className="button primary" onClick={start}>
          {t.mfa.start}
        </button>
      )}
    </section>
  );
}

export function MfaVerify({ onVerified }: { onVerified: () => void }) {
  const { t } = useLocale();
  return (
    <section className="card narrow" aria-labelledby="mfa-verify-title">
      <h1 id="mfa-verify-title">{t.mfa.verifyTitle}</h1>
      <p>{t.mfa.verifyIntro}</p>
      <CodeForm onVerified={onVerified} />
    </section>
  );
}
