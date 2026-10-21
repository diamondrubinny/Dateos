import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, MFA_REQUIRED_EVENT } from './api';
import { useAsync, useRoute } from './hooks';
import { LocaleContext, messages, useLocale, type Locale } from './i18n';
import { ErrorBox, Loading } from './components/ui';
import { Audit } from './pages/Audit';
import { MfaSetup, MfaVerify } from './pages/Mfa';
import { ReportDetail } from './pages/ReportDetail';
import { Reports } from './pages/Reports';
import { SignIn } from './pages/SignIn';
import { Verifications } from './pages/Verifications';

const LOCALE_KEY = 'dateos-admin-locale';

function initialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return navigator.language.startsWith('he') ? 'he' : 'en';
}

function Shell({
  children,
  signedIn,
  onSignOut,
}: {
  children: ReactNode;
  signedIn: boolean;
  onSignOut: () => void;
}) {
  const { t, toggle, locale } = useLocale();
  const route = useRoute();
  const current = route[0] ?? 'reports';
  const link = (key: 'reports' | 'verifications' | 'audit') => (
    <li>
      <a href={`#/${key}`} aria-current={current === key ? 'page' : undefined}>
        {t.nav[key]}
      </a>
    </li>
  );
  return (
    <>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <header className="topbar">
        <span className="brand">Dateos · {t.appName}</span>
        {signedIn ? (
          <nav aria-label={t.appName}>
            <ul>
              {link('reports')}
              {link('verifications')}
              {link('audit')}
            </ul>
          </nav>
        ) : null}
        <div className="topbar-actions">
          <button
            type="button"
            className="button small"
            onClick={toggle}
            lang={locale === 'he' ? 'en' : 'he'}
          >
            {t.language}
          </button>
          {signedIn ? (
            <button type="button" className="button small" onClick={onSignOut}>
              {t.signOut}
            </button>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}

function Routes({ staff }: { staff: NonNullable<Awaited<ReturnType<typeof api.me>>> }) {
  const route = useRoute();
  if (route[0] === 'reports' && route[1]) return <ReportDetail id={route[1]} staff={staff} />;
  if (route[0] === 'verifications') return <Verifications />;
  if (route[0] === 'audit') return <Audit />;
  return <Reports />;
}

export function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const value = useMemo(
    () => ({
      locale,
      t: messages[locale],
      toggle: () => setLocale((l) => (l === 'he' ? 'en' : 'he')),
    }),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
    document.title = `Dateos · ${messages[locale].appName}`;
    try {
      window.localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // ignore: preference is only a convenience
    }
  }, [locale]);

  const me = useAsync(() => api.me(), []);

  // Any MFA_REQUIRED from a later call (the 12-hour step-up expired) re-checks the state.
  const reloadMe = useRef(me.reload);
  reloadMe.current = me.reload;
  useEffect(() => {
    const onExpired = () => reloadMe.current();
    window.addEventListener(MFA_REQUIRED_EVENT, onExpired);
    return () => window.removeEventListener(MFA_REQUIRED_EVENT, onExpired);
  }, []);

  async function signOut() {
    await api.signOut().catch(() => undefined);
    window.location.hash = '';
    me.reload();
  }

  let content: ReactNode;
  const err = me.error;
  if (me.loading && !me.data && !err) content = <Loading />;
  else if (err instanceof ApiError && err.status === 401) content = <SignIn />;
  else if (err instanceof ApiError && err.status === 403) content = <NoAccess />;
  else if (err) content = <ErrorBox error={err} onRetry={me.reload} />;
  else if (me.data && !me.data.mfaEnabled) content = <MfaSetup onVerified={me.reload} />;
  else if (me.data && !me.data.mfaVerified) content = <MfaVerify onVerified={me.reload} />;
  else if (me.data) content = <Routes staff={me.data} />;

  const signedIn = Boolean(me.data?.mfaVerified);
  return (
    <LocaleContext.Provider value={value}>
      <Shell signedIn={signedIn} onSignOut={signOut}>
        {content}
        {err instanceof ApiError && err.status === 403 ? (
          <button type="button" className="button" onClick={signOut}>
            {value.t.signOut}
          </button>
        ) : null}
      </Shell>
    </LocaleContext.Provider>
  );
}

function NoAccess() {
  const { t } = useLocale();
  return (
    <section className="card narrow" aria-labelledby="noaccess-title">
      <h1 id="noaccess-title">{t.noAccess.title}</h1>
      <p>{t.noAccess.body}</p>
    </section>
  );
}
