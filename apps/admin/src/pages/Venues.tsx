import { type AdminVenue, venueCategories, type VenueCategory } from '@nexaheart/shared';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { Badge, ErrorBox, Loading } from '../components/ui';

type Form = {
  name: string;
  area: string;
  category: VenueCategory;
  address: string;
  note: string;
  stepFree: boolean;
};

const empty: Form = {
  name: '',
  area: '',
  category: 'cafe',
  address: '',
  note: '',
  stepFree: false,
};

const toForm = (v: AdminVenue): Form => ({
  name: v.name,
  area: v.area,
  category: v.category,
  address: v.address,
  note: v.note ?? '',
  stepFree: v.stepFree,
});

/**
 * Public places members can pick for a first date (phase 12). Everyone on staff can see the list;
 * only admins add, edit or hide places.
 */
export function Venues({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLocale();
  const list = useAsync(() => api.venues(), []);
  const [form, setForm] = useState<Form>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [notice, setNotice] = useState<string>();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const announce = (text: string) => {
    setNotice(text);
    statusRef.current?.focus();
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const input = {
      name: form.name.trim(),
      area: form.area.trim(),
      category: form.category,
      address: form.address.trim(),
      note: form.note.trim() ? form.note.trim() : null,
      stepFree: form.stepFree,
    };
    try {
      if (editing) await api.updateVenue(editing, input);
      else await api.createVenue(input);
      announce(format(editing ? t.venues.updated : t.venues.added, { name: input.name }));
      setForm(empty);
      setEditing(null);
      list.reload();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(v: AdminVenue) {
    setError(undefined);
    try {
      await api.updateVenue(v.id, { active: !v.active });
      announce(format(v.active ? t.venues.hidden : t.venues.shown, { name: v.name }));
      list.reload();
    } catch (err) {
      setError(err as Error);
    }
  }

  function edit(v: AdminVenue) {
    setEditing(v.id);
    setForm(toForm(v));
    nameRef.current?.focus();
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const text = (key: 'name' | 'area' | 'address', label: string, maxLength: number) => (
    <>
      <label htmlFor={`venue-${key}`}>{label}</label>
      <input
        id={`venue-${key}`}
        ref={key === 'name' ? nameRef : undefined}
        value={form[key]}
        required
        maxLength={maxLength}
        onChange={(e) => set(key, e.target.value)}
      />
    </>
  );

  const venues = list.data?.venues ?? [];
  return (
    <section aria-labelledby="venues-title">
      <h1 id="venues-title">{t.venues.title}</h1>
      <p className="help">{t.venues.intro}</p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={notice ? 'alert alert-ok' : 'visually-hidden'}
      >
        {notice ?? ''}
      </p>
      {error ? <ErrorBox error={error} /> : null}

      <div className="grid venues-grid">
        <div>
          {list.loading && !list.data ? <Loading /> : null}
          {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
          {list.data && venues.length === 0 ? <p className="empty">{t.venues.empty}</p> : null}
          {venues.length > 0 ? (
            <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="venues-title">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t.venues.name}</th>
                    <th scope="col">{t.venues.areaHeader}</th>
                    <th scope="col">{t.venues.category}</th>
                    <th scope="col">{t.venues.status}</th>
                    {isAdmin ? (
                      <th scope="col">
                        <span className="visually-hidden">{t.venues.actions}</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {venues.map((v) => (
                    <tr key={v.id}>
                      <th scope="row">
                        {v.name}
                        <span className="muted block cell-detail">{v.address}</span>
                      </th>
                      <td>{v.area}</td>
                      <td>
                        {t.venues.categories[v.category]}
                        {v.stepFree ? (
                          <>
                            {' '}
                            <Badge tone="ok">♿ {t.venues.stepFree}</Badge>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={v.active ? 'ok' : 'muted'}>
                          {v.active ? t.venues.active : t.venues.inactive}
                        </Badge>
                      </td>
                      {isAdmin ? (
                        <td className="actions">
                          <button type="button" className="button small" onClick={() => edit(v)}>
                            {t.venues.edit}
                            <span className="visually-hidden"> {v.name}</span>
                          </button>
                          <button
                            type="button"
                            className="button small"
                            onClick={() => void toggle(v)}
                          >
                            {v.active ? t.venues.hide : t.venues.show}
                            <span className="visually-hidden"> {v.name}</span>
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {isAdmin ? (
          <form className="card" onSubmit={save} aria-labelledby="venue-form-title">
            <h2 id="venue-form-title">{editing ? t.venues.editTitle : t.venues.addTitle}</h2>
            {text('name', t.venues.name, 80)}
            {text('area', t.venues.area, 80)}
            <label htmlFor="venue-category">{t.venues.category}</label>
            <select
              id="venue-category"
              value={form.category}
              onChange={(e) => set('category', e.target.value as VenueCategory)}
            >
              {venueCategories.map((c) => (
                <option key={c} value={c}>
                  {t.venues.categories[c]}
                </option>
              ))}
            </select>
            {text('address', t.venues.address, 160)}
            <label htmlFor="venue-note">
              {t.venues.note} <span className="muted">({t.branding.optional})</span>
            </label>
            <textarea
              id="venue-note"
              rows={3}
              maxLength={300}
              value={form.note}
              aria-describedby="venue-note-help"
              onChange={(e) => set('note', e.target.value)}
            />
            <p id="venue-note-help" className="help">
              {t.venues.noteHelp}
            </p>
            <div className="checkbox">
              <input
                id="venue-stepfree"
                type="checkbox"
                checked={form.stepFree}
                onChange={(e) => set('stepFree', e.target.checked)}
              />
              <label htmlFor="venue-stepfree">{t.venues.stepFreeLabel}</label>
            </div>
            <div className="actions">
              <button type="submit" className="button primary" disabled={busy}>
                {editing ? t.venues.save : t.venues.add}
              </button>
              {editing ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setEditing(null);
                    setForm(empty);
                  }}
                >
                  {t.venues.cancel}
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
