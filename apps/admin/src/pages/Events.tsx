// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  type AdminCheckIn,
  type AdminEvent,
  type EventBoard,
  MAX_EVENT_ANSWER_LENGTH,
  MAX_EVENT_UPDATE_LENGTH,
  MAX_EVENT_REPEAT_WEEKS,
  SPEED_ROUND_DEFAULT,
  allStreams,
  genders,
  type Gender,
} from '@nexaheart/shared';
import QRCode from 'qrcode';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { Badge, ErrorBox, formatDate, Loading } from '../components/ui';
import { EventOrganizers } from './EventOrganizers';

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
  /** Phase 71b: who it's for, and places by gender. */
  audienceGenders: Gender[];
  ageMin: string;
  ageMax: string;
  streams: string[];
  byGender: boolean;
  pools: Record<Gender, string>;
  /** Phase 71d: reveal the place N hours before; tables of N. */
  revealHours: string;
  tableSize: string;
};

const noPools = (): Record<Gender, string> => ({ woman: '', man: '', nonbinary: '', other: '' });

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
    audienceGenders: [],
    ageMin: '',
    ageMax: '',
    streams: [],
    byGender: false,
    pools: noPools(),
    revealHours: '',
    tableSize: '',
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
  audienceGenders: e.audience.genders,
  ageMin: e.audience.ageMin === null ? '' : String(e.audience.ageMin),
  ageMax: e.audience.ageMax === null ? '' : String(e.audience.ageMax),
  streams: e.audience.faithStreams,
  byGender: e.pools !== null,
  pools: {
    ...noPools(),
    ...Object.fromEntries((e.pools ?? []).map((p) => [p.gender, String(p.capacity)])),
  },
  revealHours: e.placeRevealAt
    ? String(Math.round((Date.parse(e.startsAt) - Date.parse(e.placeRevealAt)) / 3_600_000))
    : '',
  tableSize: e.tableSize === null ? '' : String(e.tableSize),
});

/** Phase 71b: the audience and the places by gender, as the API takes them. */
function groupInput(form: Form) {
  const pools = form.byGender
    ? genders
        .filter((g) => form.pools[g].trim() !== '')
        .map((g) => ({ gender: g, capacity: Number(form.pools[g]) }))
    : null;
  return {
    audience: {
      genders: form.byGender ? [] : form.audienceGenders,
      ageMin: form.ageMin.trim() === '' ? null : Number(form.ageMin),
      ageMax: form.ageMax.trim() === '' ? null : Number(form.ageMax),
      faithStreams: form.streams as (typeof allStreams)[number][],
    },
    pools,
  };
}

/** "Repeat weekly" (phase 71b): 1 to 12 copies a week apart. */
function RepeatControl({ event, onDone }: { event: AdminEvent; onDone: (n: number) => void }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState('4');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="button small" onClick={() => setOpen(true)}>
        {t.events.repeat}
        <span className="visually-hidden"> {event.title}</span>
      </button>
    );
  }
  const id = `repeat-${event.id}`;
  return (
    <span className="inline-form">
      <label htmlFor={id}>{t.events.repeatWeeks}</label>
      <select id={id} value={weeks} onChange={(e) => setWeeks(e.target.value)}>
        {Array.from({ length: MAX_EVENT_REPEAT_WEEKS }, (_, i) => (
          <option key={i + 1} value={String(i + 1)}>
            {i + 1}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="button small primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(undefined);
          api
            .repeatEvent(event.id, Number(weeks))
            .then((r) => {
              setOpen(false);
              onDone(r.events.length);
            })
            .catch((err: Error) => setError(err))
            .finally(() => setBusy(false));
        }}
      >
        {t.events.repeatYes}
      </button>
      <button type="button" className="button small" onClick={() => setOpen(false)}>
        {t.events.confirmNo}
      </button>
      {error ? <ErrorBox error={error} /> : null}
    </span>
  );
}

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

/**
 * Updates to everyone going or waiting, and answers to their questions (phase 27). Questions come
 * without who asked; moderators can read, admins write.
 */
function BoardPanel({
  event,
  isAdmin,
  onClose,
}: {
  event: AdminEvent;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const [board, setBoard] = useState<EventBoard>();
  const [error, setError] = useState<Error>();
  const [update, setUpdate] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    api.eventBoard(event.id).then(setBoard, (err: Error) => setError(err));
  }, [event.id]);

  const run = async (action: () => Promise<EventBoard>, done: string) => {
    setBusy(true);
    setError(undefined);
    try {
      setBoard(await action());
      setStatus(done);
      return true;
    } catch (err) {
      setError(err as Error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const open = event.status === 'scheduled' && Date.parse(event.endsAt) > Date.now();

  return (
    <section className="card board" aria-labelledby="board-title">
      <h2 id="board-title" ref={headingRef} tabIndex={-1}>
        {format(t.events.boardTitle, { title: event.title })}
      </h2>
      <p className="help">{t.events.boardHelp}</p>
      <p role="status" className={status ? 'alert alert-ok' : 'visually-hidden'}>
        {status}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      {!board && !error ? <Loading /> : null}
      {board ? (
        <>
          {isAdmin && open ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => api.postEventUpdate(event.id, update.trim()),
                  t.events.updatePosted,
                ).then((ok) => ok && setUpdate(''));
              }}
            >
              <label htmlFor="event-update">{t.events.updateLabel}</label>
              <textarea
                id="event-update"
                value={update}
                maxLength={MAX_EVENT_UPDATE_LENGTH}
                onChange={(e) => setUpdate(e.target.value)}
                rows={3}
                required
              />
              <button type="submit" className="button primary" disabled={busy || !update.trim()}>
                {t.events.postUpdate}
              </button>
            </form>
          ) : null}
          {board.updates.length === 0 ? (
            <p className="empty">{t.events.noUpdates}</p>
          ) : (
            <ul className="board-list">
              {board.updates.map((u) => (
                <li key={u.id}>
                  <p className="muted">{formatDate(u.createdAt, locale)}</p>
                  <p dir="auto">{u.body}</p>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="button small"
                      disabled={busy}
                      onClick={() =>
                        void run(() => api.deleteEventUpdate(event.id, u.id), t.events.deleteUpdate)
                      }
                    >
                      {t.events.deleteUpdate}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <h3>{t.events.questions}</h3>
          {board.questions.length === 0 ? (
            <p className="empty">{t.events.noQuestions}</p>
          ) : (
            <ul className="board-list">
              {board.questions.map((q) => (
                <li key={q.id} className={q.urgent && !q.answer ? 'urgent-item' : undefined}>
                  <p className="muted">
                    {q.urgent ? (
                      // Phase 71c: someone at the event needs help now.
                      <>
                        <Badge tone="urgent">{t.events.urgent}</Badge>{' '}
                      </>
                    ) : null}
                    {formatDate(q.createdAt, locale)}
                  </p>
                  <p dir="auto">
                    <strong>{q.body}</strong>
                  </p>
                  {q.answer ? (
                    <p dir="auto">
                      <Badge tone="ok">{t.events.answered}</Badge> {q.answer}
                    </p>
                  ) : isAdmin ? (
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(
                          () =>
                            api.answerEventQuestion(event.id, q.id, (answers[q.id] ?? '').trim()),
                          t.events.answerSent,
                        );
                      }}
                    >
                      <label htmlFor={`answer-${q.id}`}>{t.events.answerLabel}</label>
                      <textarea
                        id={`answer-${q.id}`}
                        value={answers[q.id] ?? ''}
                        maxLength={MAX_EVENT_ANSWER_LENGTH}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                        rows={2}
                        required
                      />
                      <button
                        type="submit"
                        className="button small primary"
                        disabled={busy || !(answers[q.id] ?? '').trim()}
                      >
                        {t.events.sendAnswer}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
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
  // Phase 71b: streams are offered only with the faith module on.
  const settings = useAsync(() => (isAdmin ? api.settings() : Promise.resolve(null)), [isAdmin]);
  const faithOn = settings.data?.faithModule ?? false;
  const [form, setForm] = useState<Form>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<AdminEvent | null>(null);
  const [boardFor, setBoardFor] = useState<AdminEvent | null>(null);
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
      ...groupInput(form),
      revealHours: form.revealHours.trim() === '' ? null : Number(form.revealHours),
      tableSize: form.tableSize.trim() === '' ? null : Number(form.tableSize),
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
  /** "For women · 25–35", or nothing for everyone. */
  const audienceText = (e: AdminEvent) => {
    const parts: string[] = [];
    if (e.audience.genders.length > 0) {
      parts.push(e.audience.genders.map((g) => t.branding.genders[g]).join(', '));
    }
    if (e.audience.ageMin !== null || e.audience.ageMax !== null) {
      // Isolated left to right, so a range reads 25–40 in Hebrew too.
      parts.push(`\u2066${e.audience.ageMin ?? 18}–${e.audience.ageMax ?? 99}\u2069`);
    }
    if (e.audience.faithStreams.length > 0) {
      parts.push(
        e.audience.faithStreams
          .map((s) => t.events.streams[s as keyof typeof t.events.streams] ?? s)
          .join(', '),
      );
    }
    return parts.length > 0 ? format(t.events.audienceLine, { who: parts.join(' · ') }) : '';
  };
  const setPool = (g: Gender, value: string) =>
    setForm({ ...form, pools: { ...form.pools, [g]: value } });
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
      {boardFor ? (
        <BoardPanel event={boardFor} isAdmin={isAdmin} onClose={() => setBoardFor(null)} />
      ) : null}

      {isAdmin ? <EventOrganizers onPublished={list.reload} /> : null}
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
                        {e.pools?.map((p) => (
                          <span key={p.gender} className="muted block cell-detail">
                            {format(t.events.poolLine, {
                              group: t.branding.genders[p.gender],
                              n: p.going,
                              capacity: p.capacity,
                              waiting: p.waiting,
                            })}
                          </span>
                        ))}
                        {e.tables ? (
                          <span className="muted block cell-detail">
                            {format(t.events.tablesLine, {
                              n: e.tables.length,
                              sizes: e.tables.join(', '),
                            })}
                          </span>
                        ) : e.tableSize ? (
                          <span className="muted block cell-detail">
                            {format(t.events.tablesOf, { n: e.tableSize })}
                          </span>
                        ) : null}
                        {audienceText(e) ? (
                          <span className="muted block cell-detail">{audienceText(e)}</span>
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
                        </Badge>{' '}
                        <button
                          type="button"
                          className="button small"
                          onClick={() => setBoardFor(e)}
                        >
                          {t.events.board}
                          <span className="visually-hidden"> {e.title}</span>
                        </button>
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
                                <RepeatControl
                                  event={e}
                                  onDone={(n) => {
                                    announce(format(t.events.repeated, { title: e.title, n }));
                                    list.reload();
                                  }}
                                />
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
              required={form.kind === 'speed' && !form.byGender}
              disabled={form.byGender}
              inputMode="numeric"
              value={form.capacity}
              aria-describedby="event-capacity-help"
              onChange={(e) => set('capacity', e.target.value)}
            />
            <p id="event-capacity-help" className="help">
              {t.events.capacityHelp}
            </p>
            <label htmlFor="event-reveal">{t.events.revealHours}</label>
            <input
              id="event-reveal"
              type="number"
              min={1}
              max={72}
              inputMode="numeric"
              dir="ltr"
              value={form.revealHours}
              aria-describedby="event-reveal-help"
              onChange={(e) => set('revealHours', e.target.value)}
            />
            <p id="event-reveal-help" className="help">
              {t.events.revealHelp}
            </p>
            <label htmlFor="event-tables">{t.events.tableSize}</label>
            <input
              id="event-tables"
              type="number"
              min={4}
              max={10}
              inputMode="numeric"
              dir="ltr"
              value={form.tableSize}
              aria-describedby="event-tables-help"
              onChange={(e) => set('tableSize', e.target.value)}
            />
            <p id="event-tables-help" className="help">
              {t.events.tableHelp}
            </p>
            <fieldset aria-describedby="event-audience-help">
              <legend>{t.events.audienceTitle}</legend>
              <p id="event-audience-help" className="help">
                {t.events.audienceHelp}
              </p>
              <div className="checkbox">
                <input
                  id="event-by-gender"
                  type="checkbox"
                  checked={form.byGender}
                  aria-describedby="event-by-gender-help"
                  onChange={(e) => set('byGender', e.target.checked)}
                />
                <label htmlFor="event-by-gender">{t.events.byGender}</label>
              </div>
              <p id="event-by-gender-help" className="help">
                {t.events.byGenderHelp}
              </p>
              {form.byGender ? (
                genders.map((g) => (
                  <div key={g}>
                    <label htmlFor={`event-pool-${g}`}>
                      {format(t.events.poolPlaces, { group: t.branding.genders[g] })}
                    </label>
                    <input
                      id={`event-pool-${g}`}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      dir="ltr"
                      value={form.pools[g]}
                      onChange={(e) => setPool(g, e.target.value)}
                    />
                  </div>
                ))
              ) : (
                <fieldset>
                  <legend>{t.events.onlyGenders}</legend>
                  {genders.map((g) => (
                    <div key={g} className="checkbox">
                      <input
                        id={`event-gender-${g}`}
                        type="checkbox"
                        checked={form.audienceGenders.includes(g)}
                        onChange={(e) =>
                          set(
                            'audienceGenders',
                            e.target.checked
                              ? genders.filter((x) => x === g || form.audienceGenders.includes(x))
                              : form.audienceGenders.filter((x) => x !== g),
                          )
                        }
                      />
                      <label htmlFor={`event-gender-${g}`}>{t.branding.genders[g]}</label>
                    </div>
                  ))}
                </fieldset>
              )}
              <div className="time-row">
                <div>
                  <label htmlFor="event-age-min">{t.events.ageMin}</label>
                  <input
                    id="event-age-min"
                    type="number"
                    min={18}
                    max={99}
                    inputMode="numeric"
                    dir="ltr"
                    value={form.ageMin}
                    onChange={(e) => set('ageMin', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="event-age-max">{t.events.ageMax}</label>
                  <input
                    id="event-age-max"
                    type="number"
                    min={18}
                    max={99}
                    inputMode="numeric"
                    dir="ltr"
                    value={form.ageMax}
                    onChange={(e) => set('ageMax', e.target.value)}
                  />
                </div>
              </div>
              {faithOn ? (
                <fieldset>
                  <legend>{t.events.onlyStreams}</legend>
                  {allStreams.map((st) => (
                    <div key={st} className="checkbox">
                      <input
                        id={`event-stream-${st}`}
                        type="checkbox"
                        checked={form.streams.includes(st)}
                        onChange={(e) =>
                          set(
                            'streams',
                            e.target.checked
                              ? [...form.streams, st]
                              : form.streams.filter((x) => x !== st),
                          )
                        }
                      />
                      <label htmlFor={`event-stream-${st}`}>{t.events.streams[st]}</label>
                    </div>
                  ))}
                </fieldset>
              ) : null}
            </fieldset>
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
