// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  EMAIL_PRESET_HOSTS,
  integrationCatalog,
  integrationGroups,
  type IntegrationField,
  type IntegrationView,
} from '@nexaheart/shared';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { Badge, ErrorBox, formatDate, Loading } from '../components/ui';

type Value = string | number | boolean;

/** Whether a field applies, given the other choices (e.g. Telegram's chat id). */
const visible = (f: IntegrationField, values: Record<string, Value>) =>
  !f.when || f.when.values.includes(String(values[f.when.key] ?? ''));

function defaults(view: IntegrationView): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const f of integrationCatalog[view.id].fields) {
    if (f.kind === 'secret') continue;
    out[f.key] = view.settings[f.key] ?? f.default ?? (f.kind === 'boolean' ? false : '');
  }
  return out;
}

function status(view: IntegrationView): 'env' | 'error' | 'on' | 'off' | 'none' {
  if (view.source === 'env') return 'env';
  if (view.lastTest && !view.lastTest.ok) return 'error';
  if (view.source === 'dashboard') return view.enabled ? 'on' : 'off';
  return 'none';
}

/** One integration: what it is, what it sends, its status, and its settings. */
function Card({
  view,
  editable,
  onChanged,
}: {
  view: IntegrationView;
  editable: boolean;
  onChanged: (message: string) => void;
}) {
  const { t, locale } = useLocale();
  const i = t.integrations;
  const def = integrationCatalog[view.id];
  const name = i.items[view.id].name;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, Value>>(() => defaults(view));
  const [enabled, setEnabled] = useState(view.source === 'none' ? true : view.enabled);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const [confirmOff, setConfirmOff] = useState(false);
  const deliveries = useAsync(
    () => (view.id === 'webhooks' && open ? api.webhookDeliveries() : Promise.resolve(null)),
    [view.id, open],
  );
  const st = status(view);
  const locked = view.source === 'env' || view.serverOnly;
  const id = (key: string) => `int-${view.id}-${key}`;

  const set = (key: string, value: Value) => {
    const next = { ...values, [key]: value };
    // Choosing an email provider fills in its server.
    if (view.id === 'email' && key === 'preset' && value !== 'custom') {
      next.host = EMAIL_PRESET_HOSTS[value as keyof typeof EMAIL_PRESET_HOSTS];
      next.port = 587;
      next.secure = false;
    }
    setValues(next);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const settings: Record<string, Value> = {};
      for (const f of def.fields) {
        if (f.kind === 'secret' || !visible(f, values)) continue;
        const v = values[f.key];
        if (v === '' || v === undefined) continue;
        settings[f.key] = f.kind === 'number' ? Number(v) : v;
      }
      const secretUpdates: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(secrets)) if (v.trim()) secretUpdates[k] = v.trim();
      for (const k of remove) secretUpdates[k] = null;
      await api.saveIntegration(view.id, { enabled, settings, secrets: secretUpdates });
      setSecrets({});
      setRemove(new Set());
      onChanged(format(i.saved, { name }));
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      setResult(await api.testIntegration(view.id));
      onChanged('');
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await api.removeIntegration(view.id);
      setConfirmOff(false);
      setOpen(false);
      onChanged(format(i.removed, { name }));
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const field = (f: IntegrationField) => {
    const label = i.fields[f.key as keyof typeof i.fields] ?? f.key;
    const optionLabel = (o: string) => (i.options as Record<string, string>)[o] ?? o;
    switch (f.kind) {
      case 'boolean':
        return (
          <label key={f.key} className="check" htmlFor={id(f.key)}>
            <input
              id={id(f.key)}
              type="checkbox"
              checked={values[f.key] === true}
              disabled={locked}
              onChange={(e) => set(f.key, e.target.checked)}
            />{' '}
            {label}
          </label>
        );
      case 'select':
        return (
          <div key={f.key}>
            <label htmlFor={id(f.key)}>{label}</label>
            <select
              id={id(f.key)}
              value={String(values[f.key] ?? '')}
              disabled={locked}
              onChange={(e) => set(f.key, e.target.value)}
            >
              {f.options!.map((o) => (
                <option key={o} value={o}>
                  {optionLabel(o)}
                </option>
              ))}
            </select>
          </div>
        );
      case 'multi': {
        const chosen = new Set(
          String(values[f.key] ?? '')
            .split(',')
            .filter(Boolean),
        );
        return (
          <fieldset key={f.key} disabled={locked}>
            <legend>{label}</legend>
            {f.options!.map((o) => (
              <label key={o} className="check">
                <input
                  type="checkbox"
                  checked={chosen.has(o)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(o);
                    else next.delete(o);
                    set(f.key, [...next].join(','));
                  }}
                />{' '}
                {optionLabel(o)}
              </label>
            ))}
          </fieldset>
        );
      }
      case 'secret': {
        const stored = view.secretsSet.includes(f.key);
        return (
          <div key={f.key}>
            <label htmlFor={id(f.key)}>
              {label}
              {!f.required ? <span className="muted"> ({t.branding.optional})</span> : null}
            </label>
            <input
              id={id(f.key)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={locked || remove.has(f.key)}
              value={secrets[f.key] ?? ''}
              placeholder={stored ? '••••••••' : ''}
              aria-describedby={stored ? `${id(f.key)}-help` : undefined}
              onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })}
            />
            {stored && !locked ? (
              <>
                <p id={`${id(f.key)}-help`} className="help">
                  {i.secretSet}
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={remove.has(f.key)}
                    onChange={(e) => {
                      const next = new Set(remove);
                      if (e.target.checked) next.add(f.key);
                      else next.delete(f.key);
                      setRemove(next);
                    }}
                  />{' '}
                  {i.secretRemove}
                </label>
              </>
            ) : null}
          </div>
        );
      }
      default:
        return (
          <div key={f.key}>
            <label htmlFor={id(f.key)}>
              {label}
              {!f.required ? <span className="muted"> ({t.branding.optional})</span> : null}
            </label>
            <input
              id={id(f.key)}
              type={f.kind === 'number' ? 'number' : f.kind === 'url' ? 'url' : 'text'}
              inputMode={f.kind === 'number' ? 'numeric' : undefined}
              dir={f.kind === 'url' || f.kind === 'number' ? 'ltr' : undefined}
              min={f.min}
              max={f.max}
              required={f.required && enabled}
              disabled={locked}
              value={String(values[f.key] ?? '')}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        );
    }
  };

  return (
    <article className="card integration" aria-labelledby={id('title')}>
      <div className="integration-head">
        <h3 id={id('title')}>{name}</h3>
        <Badge tone={st === 'on' || st === 'env' ? 'ok' : st === 'error' ? 'urgent' : 'muted'}>
          {i.status[st]}
        </Badge>
      </div>
      <p>{i.items[view.id].description}</p>
      <p className="help">
        <strong>{i.sends}</strong> {i.items[view.id].data}
      </p>
      {def.needsConsent ? <p className="help">{i.consentNote}</p> : null}
      {def.restart ? <p className="help">{i.restartNote}</p> : null}
      {view.source === 'env' ? <p className="help">{i.envLocked}</p> : null}
      {view.serverOnly ? <p className="help">{i.serverOnly}</p> : null}
      {view.cspHosts.length > 0 ? (
        <p className="help">
          {i.cspNote} <code dir="ltr">CSP_EXTRA_HOSTS={view.cspHosts.join(' ')}</code>
        </p>
      ) : null}
      {view.lastTest ? (
        <p className={view.lastTest.ok ? 'help' : 'help error-text'}>
          {format(i.lastTest, { when: formatDate(view.lastTest.at, locale), message: '' })}
          <bdi>{view.lastTest.message}</bdi>
        </p>
      ) : null}
      {result ? (
        <p role="status" className={result.ok ? 'alert alert-ok' : 'alert alert-error'}>
          {/* The server's message may be in another language than the page. */}
          <bdi>{result.message}</bdi>
        </p>
      ) : null}
      {error ? <ErrorBox error={error} /> : null}

      <div className="actions">
        {!view.serverOnly ? (
          <button
            type="button"
            className="button small"
            aria-expanded={open}
            aria-controls={id('form')}
            onClick={() => setOpen(!open)}
          >
            {open ? i.close : view.source === 'env' ? i.view : i.setup}
            <span className="visually-hidden"> {name}</span>
          </button>
        ) : null}
        {view.source !== 'none' || view.serverOnly ? (
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => void test()}
          >
            {busy ? i.testing : i.test}
            <span className="visually-hidden"> {name}</span>
          </button>
        ) : null}
      </div>

      {open ? (
        <form id={id('form')} onSubmit={save} className="integration-form">
          {!locked ? (
            <label className="check" htmlFor={id('enabled')}>
              <input
                id={id('enabled')}
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />{' '}
              {i.enable}
            </label>
          ) : null}
          {def.fields.filter((f) => visible(f, values)).map(field)}
          {!locked ? (
            <div className="actions">
              <button type="submit" className="button primary" disabled={busy || !editable}>
                {i.save}
              </button>
              {view.source === 'dashboard' ? (
                confirmOff ? (
                  <>
                    <span role="alert">{i.confirmOff}</span>
                    <button
                      type="button"
                      className="button small danger"
                      onClick={() => void turnOff()}
                    >
                      {i.confirmYes}
                    </button>
                    <button
                      type="button"
                      className="button small"
                      onClick={() => setConfirmOff(false)}
                    >
                      {i.confirmNo}
                    </button>
                  </>
                ) : (
                  <button type="button" className="button" onClick={() => setConfirmOff(true)}>
                    {i.off}
                  </button>
                )
              ) : null}
            </div>
          ) : null}
          {view.id === 'webhooks' ? (
            <div className="deliveries">
              <h4>{i.deliveries}</h4>
              {deliveries.data && deliveries.data.deliveries.length === 0 ? (
                <p className="empty">{i.noDeliveries}</p>
              ) : null}
              {deliveries.data && deliveries.data.deliveries.length > 0 ? (
                <div className="table-wrap" tabIndex={0} role="region" aria-label={i.deliveries}>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{i.deliveryEvent}</th>
                        <th scope="col">{i.deliveryStatus}</th>
                        <th scope="col">{i.deliveryAttempt}</th>
                        <th scope="col">{i.deliveryWhen}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveries.data.deliveries.map((d) => (
                        <tr key={d.id}>
                          <td dir="ltr">{d.event}</td>
                          <td>
                            <Badge tone={d.ok ? 'ok' : 'urgent'}>{d.status ?? '—'}</Badge>
                          </td>
                          <td>{d.attempt}</td>
                          <td>{formatDate(d.at, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}
    </article>
  );
}

/**
 * Integrations (phase 24): every outside service the app can use. Admins only. Secrets are
 * write-only; settings the server's environment sets are shown locked.
 */
export function Integrations() {
  const { t } = useLocale();
  const i = t.integrations;
  const list = useAsync(() => api.integrations(), []);
  const [notice, setNotice] = useState<string>();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const changed = (message: string) => {
    if (message) {
      setNotice(message);
      statusRef.current?.focus();
    }
    list.reload();
  };

  return (
    <section aria-labelledby="integrations-title">
      <h1 id="integrations-title">{i.title}</h1>
      <p className="help">{i.intro}</p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={notice ? 'alert alert-ok' : 'visually-hidden'}
      >
        {notice ?? ''}
      </p>
      {list.loading && !list.data ? <Loading /> : null}
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
      {list.data && !list.data.editable ? <p className="alert alert-error">{i.readOnly}</p> : null}
      {list.data
        ? integrationGroups.map((group) => {
            const items = list.data!.integrations.filter((v) => v.group === group);
            if (items.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`group-${group}`} className="integration-group">
                <h2 id={`group-${group}`}>{i.groups[group]}</h2>
                <div className="integration-grid">
                  {items.map((view) => (
                    <Card
                      // A fresh card after each save, with the stored values.
                      key={`${view.id}-${view.source}-${view.enabled}-${view.secretsSet.join()}`}
                      view={view}
                      editable={list.data!.editable}
                      onChanged={changed}
                    />
                  ))}
                </div>
              </section>
            );
          })
        : null}
    </section>
  );
}
