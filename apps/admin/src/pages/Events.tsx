// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { type AdminCheckIn, type AdminEvent, SPEED_ROUND_DEFAULT } from '@nexaheart/shared';
import QRCode from 'qrcode';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  kind: 'standard' | 'speed';
  roundMinutes: string;
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
    kind: 'standard',
    roundMinutes: String(SPEED_ROUND_DEFAULT),
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
  kind: e.kind,
  roundMinutes: String(e.roundMinutes ?? SPEED_ROUND_DEFAULT),
});

/**
 * The check-in code to show on a screen at the venue (phase 23): a QR code that opens the event in
 * the app with the code filled in, and the same 6 digits in text. It changes every 30 seconds.
 */
function CheckInPanel({ event, onClose }: { event: AdminEvent; onClose: () => void }) {
  const { t } = useLocale();
  const [info, setInfo] = useState<AdminCheckIn>();
  const [qr, setQr] = useState<string>();
  const [error, setError] = useState<Error>();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await api.checkIn(event.id);
        const image = await QRCode.toDataURL(next.url, { margin: 1, width: 320 });
        if (stopped) return;
        setInfo(next);
        setQr(image);
        setError(undefined);
        timer = setTimeout(load, Math.max(1000, Date.parse(next.changesAt) - Date.now() + 300));
      } catch (err) {
        if (!stopped) setError(err as Error);
      }
    };
    void load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [event.id]);

  return (
    <section className="card check-in" aria-labelledby="check-in-title">
      <h2 id="check-in-title" ref={headingRef} tabIndex={-1}>
        {format(t.events.checkInTitle, { title: event.title })}
      </h2>
      <p className="help">{t.events.checkInHelp}</p>
      {error ? <ErrorBox error={error} /> : null}
      {info && qr ? (
        <>
          <img src={qr} width={320} height={320} alt={t.events.checkInQrAlt} />
          <p
            className="check-in-code"
            aria-label={format(t.events.checkInCodeLabel, { code: info.code.split('').join(' ') })}
          >
            {info.code}
          </p>
          <p className="muted" role="status">
            {format(t.events.checkedInCount, { n: info.checkedInCount })}
          </p>
        </>
      ) : !error ? (
        <Loading />
      ) : null}
      <button type="button" className="button" onClick={onClose}>
        {t.events.checkInClose}
      </button>
    </section>
  );
}

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
  const [checkIn, setCheckIn] = useState<AdminEvent | null>(null);
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
    const speed = form.kind === 'speed' ? { roundMinutes: Number(form.roundMinutes) } : {};
    try {
      if (editing) await api.updateEvent(editing, { ...input, ...speed });
      else await api.createEvent({ ...input, kind: form.kind, ...speed });
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
      {checkIn ? <CheckInPanel event={checkIn} onClose={() => setCheckIn(null)} /> : null}

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
                        {e.kind === 'speed' ? (
                          <span className="block cell-detail">
                            {format(t.events.speedLabel, {
                              minutes: e.roundMinutes ?? SPEED_ROUND_DEFAULT,
                            })}
                          </span>
                        ) : null}
                        <span className="muted block cell-detail">
                          {e.venue ? `${e.venue.name}, ${e.venue.area}` : t.events.noPlace}
                        </span>
                      </th>
                      <td>{formatDate(e.startsAt, locale)}</td>
                      <td>
                        {e.capacity === null
                          ? e.going
                          : format(t.events.ofCapacity, { n: e.going, capacity: e.capacity })}
                        {e.waitingCount > 0 ? (
                          <span className="muted">
                            {' · '}
                            {format(t.events.waitingCount, { n: e.waitingCount })}
                          </span>
                        ) : null}
                        {e.checkedInCount > 0 ? (
                          <span className="muted block cell-detail">
                            {format(t.events.checkedInCount, { n: e.checkedInCount })}
                          </span>
                        ) : null}
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
                                  onClick={() => setCheckIn(e)}
                                >
                                  {t.events.checkIn}
                                  <span className="visually-hidden"> {e.title}</span>
                                </button>
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
            <label htmlFor="event-kind">{t.events.kind}</label>
            <select
              id="event-kind"
              value={form.kind}
              disabled={editing !== null}
              aria-describedby="event-kind-help"
              onChange={(e) => {
                const kind = e.target.value as Form['kind'];
                setForm({
                  ...form,
                  kind,
                  capacity: kind === 'speed' && !form.capacity ? '20' : form.capacity,
                });
              }}
            >
              <option value="standard">{t.events.kindStandard}</option>
              <option value="speed">{t.events.kindSpeed}</option>
            </select>
            <p id="event-kind-help" className="help">
              {form.kind === 'speed' ? t.events.kindSpeedHelp : t.events.kindStandardHelp}
            </p>
            {form.kind === 'speed' ? (
              <>
                <label htmlFor="event-round">{t.events.roundMinutes}</label>
                <input
                  id="event-round"
                  type="number"
                  min={3}
                  max={10}
                  required
                  inputMode="numeric"
                  value={form.roundMinutes}
                  onChange={(e) => set('roundMinutes', e.target.value)}
                />
              </>
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
              max={form.kind === 'speed' ? 40 : 10000}
              required={form.kind === 'speed'}
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
