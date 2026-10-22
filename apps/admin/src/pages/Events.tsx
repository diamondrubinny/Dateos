import { type AdminEvent } from '@nexaheart/shared';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { Badge, ErrorBox, formatDate, Loading } from '../components/ui';

type Form = {
  title: string;
  description: string;
  venueId: string;
  date: string;
  start: string;
  end: string;
  capacity: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function emptyForm(): Form {
  const nextWeek = new Date(Date.now() + 7 * 86_400_000);
  return {
    title: '',
    description: '',
    venueId: '',
    date: localDate(nextWeek),
    start: '19:00',
    end: '21:00',
    capacity: '',
  };
}

const toForm = (e: AdminEvent): Form => ({
  title: e.title,
  description: e.description,
  venueId: e.venueId ?? '',
  date: localDate(new Date(e.startsAt)),
  start: localTime(new Date(e.startsAt)),
  end: localTime(new Date(e.endsAt)),
  capacity: e.capacity === null ? '' : String(e.capacity),
});

/** Start and end in the staff member's own time zone; an end before the start is the next day. */
function times(form: Form): { startsAt: string; endsAt: string } {
  const startsAt = new Date(`${form.date}T${form.start}`);
  const endsAt = new Date(`${form.date}T${form.end}`);
  if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

/**
 * Community events (phase 14). Staff see how many people are going, never who. Only admins
 * publish, edit and cancel.
 */
export function Events({ isAdmin }: { isAdmin: boolean }) {
  const { t, locale } = useLocale();
  const list = useAsync(() => api.events(), []);
  const venues = useAsync(() => api.venues(), []);
  const [form, setForm] = useState<Form>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [notice, setNotice] = useState<string>();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const announce = (text: string) => {
    setNotice(text);
    statusRef.current?.focus();
  };
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const activeVenues = (venues.data?.venues ?? []).filter((v) => v.active);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const input = {
      title: form.title.trim(),
      description: form.description.trim(),
      venueId: form.venueId,
      ...times(form),
      capacity: form.capacity ? Number(form.capacity) : null,
    };
    try {
      if (editing) await api.updateEvent(editing, input);
      else await api.createEvent(input);
      announce(format(editing ? t.events.updated : t.events.published, { title: input.title }));
      setForm(emptyForm());
      setEditing(null);
      list.reload();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(e: AdminEvent) {
    setError(undefined);
    try {
      await api.cancelEvent(e.id);
      setConfirmCancel(null);
      announce(format(t.events.cancelled, { title: e.title, n: e.going }));
      list.reload();
    } catch (err) {
      setError(err as Error);
    }
  }

  const events = list.data?.events ?? [];
  const upcoming = (e: AdminEvent) => Date.parse(e.endsAt) > Date.now();
  return (
    <section aria-labelledby="events-title">
      <h1 id="events-title">{t.events.title}</h1>
      <p className="help">{t.events.intro}</p>
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
          {list.data && events.length === 0 ? <p className="empty">{t.events.empty}</p> : null}
          {events.length > 0 ? (
            <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="events-title">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t.events.event}</th>
                    <th scope="col">{t.events.when}</th>
                    <th scope="col">{t.events.going}</th>
                    <th scope="col">{t.events.status}</th>
                    {isAdmin ? (
                      <th scope="col">
                        <span className="visually-hidden">{t.venues.actions}</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <th scope="row">
                        {e.title}
                        <span className="muted block cell-detail">
                          {e.venue ? `${e.venue.name}, ${e.venue.area}` : t.events.noPlace}
                        </span>
                      </th>
                      <td>{formatDate(e.startsAt, locale)}</td>
                      <td>
                        {e.capacity === null
                          ? e.going
                          : format(t.events.ofCapacity, { n: e.going, capacity: e.capacity })}
                      </td>
                      <td>
                        <Badge
                          tone={e.status === 'cancelled' ? 'high' : upcoming(e) ? 'ok' : 'muted'}
                        >
                          {e.status === 'cancelled'
                            ? t.events.statusCancelled
                            : upcoming(e)
                              ? t.events.statusScheduled
                              : t.events.statusEnded}
                        </Badge>
                      </td>
                      {isAdmin ? (
                        <td className="actions">
                          {e.status === 'scheduled' && upcoming(e) ? (
                            confirmCancel === e.id ? (
                              <>
                                <span role="alert">
                                  {format(t.events.confirmCancel, { n: e.going })}
                                </span>
                                <button
                                  type="button"
                                  className="button small danger"
                                  onClick={() => void cancel(e)}
                                >
                                  {t.events.confirmYes}
                                </button>
                                <button
                                  type="button"
                                  className="button small"
                                  onClick={() => setConfirmCancel(null)}
                                >
                                  {t.events.confirmNo}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="button small"
                                  onClick={() => {
                                    setEditing(e.id);
                                    setForm(toForm(e));
                                    titleRef.current?.focus();
                                  }}
                                >
                                  {t.venues.edit}
                                  <span className="visually-hidden"> {e.title}</span>
                                </button>
                                <button
                                  type="button"
                                  className="button small"
                                  onClick={() => setConfirmCancel(e.id)}
                                >
                                  {t.events.cancel}
                                  <span className="visually-hidden"> {e.title}</span>
                                </button>
                              </>
                            )
                          ) : null}
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
          <form className="card" onSubmit={save} aria-labelledby="event-form-title">
            <h2 id="event-form-title">{editing ? t.events.editTitle : t.events.addTitle}</h2>
            {venues.data && activeVenues.length === 0 ? (
              <p className="alert alert-error">{t.events.needPlace}</p>
            ) : null}
            <label htmlFor="event-title">{t.events.titleLabel}</label>
            <input
              id="event-title"
              ref={titleRef}
              required
              minLength={2}
              maxLength={80}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
            />
            <label htmlFor="event-description">
              {t.events.description} <span className="muted">({t.branding.optional})</span>
            </label>
            <textarea
              id="event-description"
              rows={4}
              maxLength={1000}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
            <label htmlFor="event-venue">{t.events.place}</label>
            <select
              id="event-venue"
              required
              value={form.venueId}
              onChange={(e) => set('venueId', e.target.value)}
            >
              <option value="">{t.events.choosePlace}</option>
              {activeVenues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}, {v.area}
                </option>
              ))}
            </select>
            <label htmlFor="event-date">{t.events.date}</label>
            <input
              id="event-date"
              type="date"
              required
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
            <div className="time-row">
              <div>
                <label htmlFor="event-start">{t.events.start}</label>
                <input
                  id="event-start"
                  type="time"
                  required
                  value={form.start}
                  onChange={(e) => set('start', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="event-end">{t.events.end}</label>
                <input
                  id="event-end"
                  type="time"
                  required
                  value={form.end}
                  onChange={(e) => set('end', e.target.value)}
                />
              </div>
            </div>
            <label htmlFor="event-capacity">
              {t.events.capacity} <span className="muted">({t.branding.optional})</span>
            </label>
            <input
              id="event-capacity"
              type="number"
              min={2}
              max={10000}
              inputMode="numeric"
              value={form.capacity}
              aria-describedby="event-capacity-help"
              onChange={(e) => set('capacity', e.target.value)}
            />
            <p id="event-capacity-help" className="help">
              {t.events.capacityHelp}
            </p>
            <div className="actions">
              <button type="submit" className="button primary" disabled={busy}>
                {editing ? t.venues.save : t.events.publish}
              </button>
              {editing ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setEditing(null);
                    setForm(emptyForm());
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
