// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CREDIT_URL, creditText, UPSTREAM_SOURCE_URL } from '@nexaheart/shared';
import { api, ApiError, MFA_REQUIRED_EVENT } from './api';
import { useAsync, useRoute } from './hooks';
import { LocaleContext, messages, useLocale, type Locale } from './i18n';
import { ErrorBox, Loading } from './components/ui';
import { Audit } from './pages/Audit';
import { Branding } from './pages/Branding';
import { ClaimInstance } from './pages/Setup';
import { MfaSetup, MfaVerify } from './pages/Mfa';
import { ReportDetail } from './pages/ReportDetail';
import { Reports } from './pages/Reports';
import { SignIn } from './pages/SignIn';
import { Events } from './pages/Events';
import { Venues } from './pages/Venues';
import { Signup } from './pages/Signup';
import { Verifications } from './pages/Verifications';

const LOCALE_KEY = 'nexaheart-admin-locale';

/**
 * "Powered by NexaHeart · Open source". Keeping it visible is an additional term of the license
 * (AGPL-3.0 section 7(b), see NOTICE); "Open source" links to this instance's source (section 13).
 */
function PoweredBy({ locale }: { locale: Locale }) {
  const instance = useAsync(() => api.instance(), []);
  const text = creditText(locale);
  const sourceUrl = instance.data?.poweredBy.sourceUrl ?? UPSTREAM_SOURCE_URL;
  return (
    <footer className="powered-by">
      <a href={CREDIT_URL} target="_blank" rel="noopener noreferrer">
        {text.poweredBy}
      </a>
      <span aria-hidden="true"> · </span>
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
        {text.openSource}
      </a>
    </footer>
  );
}

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
  isAdmin,
  onSignOut,
}: {
  children: ReactNode;
  signedIn: boolean;
  isAdmin: boolean;
  onSignOut: () => void;
}) {
  const { t, toggle, locale } = useLocale();
  const route = useRoute();
  const current = route[0] ?? 'reports';
  const link = (
    key: 'reports' | 'verifications' | 'venues' | 'events' | 'signup' | 'audit' | 'branding',
  ) => (
    <li>
      <a href={`#/${key}`} aria-current={current === key ? 'page' : undefined}>
        {key === 'branding'
          ? t.branding.nav
          : key === 'venues'
            ? t.venues.nav
            : key === 'events'
              ? t.events.nav
              : key === 'signup'
                ? t.signup.nav
                : t.nav[key]}
      </a>
    </li>
  );
  return (
    <>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <header className="topbar">
        <span className="brand">NexaHeart · {t.appName}</span>
        {signedIn ? (
          <nav aria-label={t.appName}>
            <ul>
              {link('reports')}
              {link('verifications')}
              {link('venues')}
              {link('events')}
              {link('signup')}
              {link('audit')}
              {isAdmin ? link('branding') : null}
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
      <PoweredBy locale={locale} />
    </>
  );
}

function Routes({ staff }: { staff: NonNullable<Awaited<ReturnType<typeof api.me>>> }) {
  const route = useRoute();
  if (route[0] === 'reports' && route[1]) return <ReportDetail id={route[1]} staff={staff} />;
  if (route[0] === 'verifications') return <Verifications />;
  if (route[0] === 'venues') return <Venues isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'events') return <Events isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'signup') return <Signup isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'audit') return <Audit />;
  if (route[0] === 'branding' && staff.role === 'admin') return <Branding wizard={false} />;
  return <Reports />;
}

/** Admins finish the setup wizard (branding) before anything else. */
function AdminGate({ staff }: { staff: NonNullable<Awaited<ReturnType<typeof api.me>>> }) {
  const settings = useAsync(
    () => (staff.role === 'admin' ? api.settings() : Promise.resolve(null)),
    [staff.role],
  );
  const [finished, setFinished] = useState(false);
  if (settings.loading && settings.data === undefined) return <Loading />;
  if (settings.data && !settings.data.setupCompleted && !finished) {
    return <Branding wizard onFinish={() => setFinished(true)} />;
  }
  return <Routes staff={staff} />;
}

/** Signed in but not staff: offer the first-run claim while the instance has no admin. */
function NotStaff({ onClaimed }: { onClaimed: () => void }) {
  const instance = useAsync(() => api.instance(), []);
  if (instance.loading && !instance.data) return <Loading />;
  if (instance.data?.setupRequired) return <ClaimInstance onClaimed={onClaimed} />;
  return <NoAccess />;
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
    document.title = `NexaHeart · ${messages[locale].appName}`;
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
  else if (err instanceof ApiError && err.status === 403)
    content = <NotStaff onClaimed={me.reload} />;
  else if (err) content = <ErrorBox error={err} onRetry={me.reload} />;
  else if (me.data && !me.data.mfaEnabled) content = <MfaSetup onVerified={me.reload} />;
  else if (me.data && !me.data.mfaVerified) content = <MfaVerify onVerified={me.reload} />;
  else if (me.data) content = <AdminGate staff={me.data} />;

  const signedIn = Boolean(me.data?.mfaVerified);
  return (
    <LocaleContext.Provider value={value}>
      <Shell signedIn={signedIn} isAdmin={me.data?.role === 'admin'} onSignOut={signOut}>
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
