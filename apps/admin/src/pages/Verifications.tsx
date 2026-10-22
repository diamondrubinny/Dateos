import { useState } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { ErrorBox, formatDate, Loading, ProtectedImage } from '../components/ui';

export function Verifications() {
  const { t, locale } = useLocale();
  const { data, error, loading, reload } = useAsync(() => api.verifications(), []);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [actionError, setActionError] = useState<Error>();

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setActionError(undefined);
    try {
      await api.decide(id, approve);
      setNotice(t.verify.decided);
      reload();
    } catch (err) {
      setActionError(err as Error);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section aria-labelledby="verify-title">
      <h1 id="verify-title">{t.verify.title}</h1>
      <p>{t.verify.intro}</p>
      <p role="status" className={notice ? 'alert alert-ok' : 'visually-hidden'}>
        {notice ?? ''}
      </p>
      {actionError ? <ErrorBox error={actionError} /> : null}
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {data && data.verifications.length === 0 ? <p className="empty">{t.verify.empty}</p> : null}
      {data?.verifications.map((v) => {
        const name = v.displayName ?? '—';
        return (
          <article key={v.id} className="card" aria-labelledby={`v-${v.id}`}>
            <h2 id={`v-${v.id}`}>
              <bdi>{name}</bdi>{' '}
              <span className="muted small">{formatDate(v.createdAt, locale)}</span>
            </h2>
            <p>
              {t.verify.pose}: <strong>{t.poses[v.pose]}</strong>
            </p>
            <div className="compare">
              <figure>
                <ProtectedImage
                  path={api.selfiePath(v.id)}
                  alt={format(t.verify.selfieAlt, { name })}
                  className="photo large"
                />
                <figcaption>{t.verify.selfie}</figcaption>
              </figure>
              <figure>
                <div className="photo-grid">
                  {v.profilePhotoIds.map((photoId, i) => (
                    <ProtectedImage
                      key={photoId}
                      path={api.photoPath(v.userId, photoId)}
                      alt={format(t.detail.photoAlt, { n: i + 1 })}
                      className="photo"
                    />
                  ))}
                </div>
                <figcaption>{t.verify.profile}</figcaption>
              </figure>
            </div>
            <div className="actions">
              <button
                type="button"
                className="button primary"
                disabled={busy === v.id}
                onClick={() => decide(v.id, true)}
              >
                {t.verify.approve}
                <span className="visually-hidden">: {name}</span>
              </button>
              <button
                type="button"
                className="button danger"
                disabled={busy === v.id}
                onClick={() => decide(v.id, false)}
              >
                {t.verify.reject}
                <span className="visually-hidden">: {name}</span>
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
